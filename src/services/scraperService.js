const axios = require("axios");
const { DOMParser } = require("@xmldom/xmldom");
const xpath = require("xpath");
const scraperModel = require("../models/scraperModel");
const prisma = require("../middleware/prisma");
const cheerio = require("cheerio");

class ScraperService {
  _resolveUrl(value, baseUrl) {
    if (!value || !baseUrl) return value;
    if (/^https?:\/\//i.test(value)) return value;
    try {
      const base = new URL(baseUrl);
      if (value.startsWith("/")) {
        return `${base.protocol}//${base.host}${value}`;
      }
      // ruta/relativa -> se resuelve contra la base
      return new URL(value, baseUrl).href;
    } catch {
      return value;
    }
  }

  // Extrae campos usando cheerio en vez de xpath+xmldom
  _extractFields(html, fields, baseUrl = null) {
    const $ = cheerio.load(html);
    const results = {};
    for (const f of fields || []) {
      try {
        const raw = this._evalXpathFull($, f.xpath);
        results[f.name] = this._maybeResolveUrl(raw, baseUrl);
      } catch (e) {
        results[f.name] = null;
      }
    }
    return results;
  }

  // Solo resuelve como URL si el valor parece una ruta/URL, no texto libre
  _maybeResolveUrl(value, baseUrl) {
    if (!value || !baseUrl) return value;
    const str = String(value).trim();
    // Solo resolver si parece una ruta web (empieza por / o es URL relativa con extensión de imagen/archivo)
    const looksLikePath = /^\//.test(str) || /^https?:\/\//i.test(str);
    // Excluir si contiene espacios (es texto libre, no una URL)
    const hasSpaces = /\s/.test(str);
    if (looksLikePath && !hasSpaces) {
      return this._resolveUrl(str, baseUrl);
    }
    return value;
  }

  // Interpreta un subconjunto de xpath usando cheerio
  // Soporta: //tag, //tag[@attr='val'], //tag[contains(@attr,'val')],
  //          //tag[OtherTag='text'], text(), @attr, normalize-space(), substring-after(), substring-before()
  _evalXpath($, xpathExpr) {
    const expr = xpathExpr.trim();

    // normalize-space(substring-before(INNER_EXPR, 'delimiter'))
    const nsSubBefore = expr.match(
      /^normalize-space\(substring-before\((.+),\s*'([^']*)'\)\)$/,
    );
    if (nsSubBefore) {
      const inner = this._evalXpath($, nsSubBefore[1]);
      const delim = nsSubBefore[2];
      if (inner == null) return null;
      const idx = String(inner).indexOf(delim);
      return idx >= 0 ? String(inner).slice(0, idx).trim() : null;
    }

    // normalize-space(substring-after(INNER_EXPR, 'delimiter'))
    const nsSubAfter = expr.match(
      /^normalize-space\(substring-after\((.+),\s*'([^']*)'\)\)$/,
    );
    if (nsSubAfter) {
      const inner = this._evalXpath($, nsSubAfter[1]);
      const delim = nsSubAfter[2];
      if (inner == null) return null;
      const idx = String(inner).indexOf(delim);
      return idx >= 0
        ? String(inner)
            .slice(idx + delim.length)
            .trim()
        : null;
    }

    // normalize-space(INNER_EXPR)
    const nsMatch = expr.match(/^normalize-space\((.+)\)$/);
    if (nsMatch) {
      const inner = this._evalXpath($, nsMatch[1]);
      return inner != null ? String(inner).replace(/\s+/g, " ").trim() : null;
    }

    // substring-before(INNER_EXPR, 'delimiter')
    const subBefore = expr.match(/^substring-before\((.+),\s*'([^']*)'\)$/);
    if (subBefore) {
      const inner = this._evalXpath($, subBefore[1]);
      const delim = subBefore[2];
      if (inner == null) return null;
      const idx = String(inner).indexOf(delim);
      return idx >= 0 ? String(inner).slice(0, idx) : null;
    }

    // substring-after(INNER_EXPR, 'delimiter')
    const subAfter = expr.match(/^substring-after\((.+),\s*'([^']*)'\)$/);
    if (subAfter) {
      const inner = this._evalXpath($, subAfter[1]);
      const delim = subAfter[2];
      if (inner == null) return null;
      const idx = String(inner).indexOf(delim);
      return idx >= 0 ? String(inner).slice(idx + delim.length) : null;
    }

    // Separar selector del path final (/text() o /@attr)
    let selectorExpr = expr;
    let finalPart = null;

    const textMatch = expr.match(/^(.*?)\/text\(\)$/);
    const attrMatch = expr.match(/^(.*?)\/@([\w-]+)$/);
    if (textMatch) {
      selectorExpr = textMatch[1];
      finalPart = "text";
    } else if (attrMatch) {
      selectorExpr = attrMatch[1];
      finalPart = `@${attrMatch[2]}`;
    }

    // Convertir ruta xpath a selector CSS cheerio
    const selector = this._xpathToSelector(selectorExpr);
    if (!selector) return null;

    const el = $(selector).first();
    if (!el.length) return null;

    if (finalPart === "text") return el.text().trim() || null;
    if (finalPart?.startsWith("@")) return el.attr(finalPart.slice(1)) || null;
    return el.text().trim() || null;
  }

  _xpathToSelector(xpathExpr) {
    // Convierte //a/b/c[@attr='val'] a selector CSS paso a paso
    // Maneja: //tag, //tag[@attr='val'], //tag[contains(@class,'x')], //tag[ChildTag='text']
    let expr = xpathExpr.trim();

    // Eliminar // inicial o /
    expr = expr.replace(/^\/\//, "").replace(/^\//, "");

    // Dividir por / pero respetar los []
    const parts = [];
    let depth = 0,
      current = "";
    for (const ch of expr) {
      if (ch === "[") depth++;
      if (ch === "]") depth--;
      if (ch === "/" && depth === 0) {
        parts.push(current);
        current = "";
      } else current += ch;
    }
    if (current) parts.push(current);

    const cssParts = parts.map((part) => this._xpathPartToCSS(part));
    if (cssParts.some((p) => p === null)) return null;

    return cssParts.join(" ");
  }

  _xpathPartToCSS(part) {
    const predMatch = part.match(/^([\w*-]+|\*)\[(.+)\]$/s);
    if (!predMatch) return part === "*" ? "*" : part;

    const tag = predMatch[1] === "*" ? "" : predMatch[1];
    const pred = predMatch[2].trim();

    // @attr='value'
    const attrEq = pred.match(/^@([\w-]+)='([^']*)'$/);
    if (attrEq) return `${tag}[${attrEq[1]}="${attrEq[2]}"]`;

    // contains(@attr,'value')
    const contains = pred.match(/^contains\(@([\w-]+),\s*'([^']*)'\)$/);
    if (contains) return `${tag}[${contains[1]}*="${contains[2]}"]`;

    // contains(.,'text') -> filtrado por texto del nodo
    const containsText = pred.match(/^contains\(\.,\s*'([^']*)'\)$/);
    if (containsText) {
      return {
        __textFilter: true,
        tag,
        text: containsText[1],
      };
    }

    // número posicional
    if (/^\d+$/.test(pred)) {
      return `${tag}:nth-of-type(${pred})`;
    }

    // ChildTag='text'
    const childText = pred.match(/^([\w-]+)='([^']*)'$/);
    if (childText) {
      return {
        __childFilter: true,
        tag,
        childTag: childText[1],
        childText: childText[2],
      };
    }

    return tag || "*";
  }

  // Versión corregida de _evalXpath que maneja el caso CHILD_FILTER
  _evalXpathFull($, xpathExpr) {
    const expr = xpathExpr.trim();

    // regex:XPATH_EXPR::PATRON
    const regexMatch = expr.match(/^regex:(.+?)::(.+)$/);
    if (regexMatch) {
      const inner = this._evalXpathFull($, regexMatch[1]);
      if (inner == null) return null;
      const match = String(inner).match(new RegExp(regexMatch[2]));
      return match?.[1] ?? null;
    }

    // normalize-space(substring-before(...))
    const nsSubBefore = expr.match(
      /^normalize-space\(substring-before\((.+),\s*'([^']*)'\)\)$/,
    );
    if (nsSubBefore) {
      const inner = this._evalXpathFull($, nsSubBefore[1]);
      const delim = nsSubBefore[2];
      if (inner == null) return null;
      const idx = String(inner).indexOf(delim);
      return idx >= 0 ? String(inner).slice(0, idx).trim() : null;
    }

    // normalize-space(substring-after(...))
    const nsSubAfter = expr.match(
      /^normalize-space\(substring-after\((.+),\s*'([^']*)'\)\)$/,
    );
    if (nsSubAfter) {
      const inner = this._evalXpathFull($, nsSubAfter[1]);
      const delim = nsSubAfter[2];
      if (inner == null) return null;
      const idx = String(inner).indexOf(delim);
      return idx >= 0
        ? String(inner)
            .slice(idx + delim.length)
            .trim()
        : null;
    }

    // normalize-space(...)
    const nsMatch = expr.match(/^normalize-space\((.+)\)$/);
    if (nsMatch) {
      const inner = this._evalXpathFull($, nsMatch[1]);
      return inner != null ? String(inner).replace(/\s+/g, " ").trim() : null;
    }

    // substring-before(substring-after(...), 'delim')  <- caso anidado
    const subBeforeAfter = expr.match(
      /^substring-before\(substring-after\((.+),\s*'([^']*)'\),\s*'([^']*)'\)$/,
    );
    if (subBeforeAfter) {
      const inner = this._evalXpathFull($, subBeforeAfter[1]);
      if (inner == null) return null;
      const afterDelim = subBeforeAfter[2];
      const beforeDelim = subBeforeAfter[3];
      const afterIdx = String(inner).indexOf(afterDelim);
      if (afterIdx < 0) return null;
      const afterStr = String(inner).slice(afterIdx + afterDelim.length);
      const beforeIdx = afterStr.indexOf(beforeDelim);
      return beforeIdx >= 0
        ? afterStr.slice(0, beforeIdx).trim()
        : afterStr.trim();
    }

    // substring-before(...)
    const subBefore = expr.match(/^substring-before\((.+),\s*'([^']*)'\)$/);
    if (subBefore) {
      const inner = this._evalXpathFull($, subBefore[1]);
      const delim = subBefore[2];
      if (inner == null) return null;
      const idx = String(inner).indexOf(delim);
      return idx >= 0 ? String(inner).slice(0, idx) : null;
    }

    // substring-after(...)
    const subAfter = expr.match(/^substring-after\((.+),\s*'([^']*)'\)$/);
    if (subAfter) {
      const inner = this._evalXpathFull($, subAfter[1]);
      const delim = subAfter[2];
      if (inner == null) return null;
      const idx = String(inner).indexOf(delim);
      return idx >= 0 ? String(inner).slice(idx + delim.length) : null;
    }

    let selectorExpr = expr;
    let finalPart = null;
    const textMatch = expr.match(/^(.*?)\/text\(\)$/);
    const attrMatch = expr.match(/^(.*?)\/@([\w-]+)$/);
    if (textMatch) {
      selectorExpr = textMatch[1];
      finalPart = "text";
    } else if (attrMatch) {
      selectorExpr = attrMatch[1];
      finalPart = `@${attrMatch[2]}`;
    }

    const el = this._resolveSelector($, selectorExpr);
    if (!el || !el.length) return null;

    if (finalPart === "text") return el.text().trim() || null;
    if (finalPart?.startsWith("@")) return el.attr(finalPart.slice(1)) || null;
    return el.text().trim() || null;
  }

  _resolveSelector($, xpathExpr) {
    let expr = xpathExpr.trim();

    const isGlobal = expr.startsWith("//");
    expr = expr.replace(/^\/\//, "").replace(/^\//, "");

    const parts = [];
    let depth = 0,
      current = "";
    for (const ch of expr) {
      if (ch === "[") depth++;
      if (ch === "]") depth--;
      if (ch === "/" && depth === 0) {
        parts.push(current);
        current = "";
      } else current += ch;
    }
    if (current) parts.push(current);

    let context = $("body");

    for (let i = 0; i < parts.length; i++) {
      const css = this._xpathPartToCSS(parts[i]);

      if (css && typeof css === "object" && css.__textFilter) {
        // contains(., 'texto') -> filtrar por texto del nodo
        const { tag, text } = css;
        const selector = tag || "*";
        const candidates = context.find(selector);
        context = candidates.filter((_, el) => {
          return $(el).text().includes(text);
        });
      } else if (css && typeof css === "object" && css.__childFilter) {
        // ChildTag='text' -> filtrar por texto de hijo
        const { tag, childTag, childText } = css;
        const selector = tag || "*";
        const candidates = context.find(selector);
        context = candidates.filter((_, el) => {
          const $el = $(el);
          return (
            $el.children(childTag).text().trim() === childText ||
            $el.find(childTag).first().text().trim() === childText
          );
        });
      } else {
        const selectorStr = typeof css === "string" ? css : "*";
        context =
          i === 0 && isGlobal
            ? context.find(selectorStr)
            : context.children(selectorStr);
      }

      if (!context || !context.length) return null;
    }

    return context.first();
  }

  async runScrape(scraperId, htmlOrUrl) {
    const scraper = await scraperModel.getScraper(scraperId);
    if (!scraper) throw new Error("Scraper not found");
    let html = null;
    if (typeof htmlOrUrl === "string") {
      const trimmed = htmlOrUrl.trim();
      const looksLikeHtml =
        /<\/?html|<\/?body|<!doctype/i.test(trimmed) || trimmed.startsWith("<");
      const looksLikeUrl = /^https?:\/\//i.test(trimmed);
      if (looksLikeHtml) {
        html = htmlOrUrl;
      } else if (looksLikeUrl) {
        const root = scraper.url.endsWith("/")
          ? scraper.url
          : scraper.url + "/";
        if (!htmlOrUrl.startsWith(root))
          throw new Error("Target URL is outside of scraper root");
        const resp = await axios.get(htmlOrUrl, {
          timeout: 10000,
          headers: { "User-Agent": "Mozilla/5.0" },
        });
        html = resp.data;
      }
    }
    if (!html) {
      const resp = await axios.get(scraper.url, {
        timeout: 10000,
        headers: { "User-Agent": "Mozilla/5.0" },
      });
      html = resp.data;
    }
    const targetUrl =
      typeof htmlOrUrl === "string" && /^https?:\/\//i.test(htmlOrUrl)
        ? htmlOrUrl
        : scraper.url;
    return this._extractFields(html, scraper.fields, targetUrl);
  }

  // async runAdHoc({ name, url, urlPattern, fields })
  async runAdHoc({ name, url, urlPattern, fields = [] }) {
    if (!url || typeof url !== "string") throw new Error("Missing url");
    let html = null;
    const trimmed = url.trim();
    const looksLikeHtml =
      /<\/?html|<\/?body|<!doctype/i.test(trimmed) || trimmed.startsWith("<");
    const looksLikeUrl = /^https?:\/\//i.test(trimmed);
    if (looksLikeHtml) {
      html = url;
    } else if (looksLikeUrl) {
      const resp = await axios.get(url, {
        timeout: 10000,
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
          "Cache-Control": "no-cache",
          Referer: "https://www.google.com/",
        },
      });
      html = resp.data;
    }
    if (!html) throw new Error("Could not obtain HTML for ad-hoc run");
    return this._extractFields(html, fields, url);
  }

  async createScraperWithFields({
    name,
    url,
    urlPattern,
    containerId,
    fields,
  }) {
    const data = {
      name,
      url,
      urlPattern,
      containerId: containerId ? Number(containerId) : undefined,
    };

    if (Array.isArray(fields) && fields.length > 0) {
      data.fields = {
        create: fields.map((f) => ({
          name: f.name,
          xpath: f.xpath,
          order: f.order || 0,
        })),
      };
    }

    const created = await prisma.scraper.create({
      data,
      include: { fields: true, container: true },
    });
    return created;
  }

  async updateScraperWithFields(
    scraperId,
    { name, url, urlPattern, containerId, fields },
  ) {
    const id = Number(scraperId);

    // Use a transaction: update scraper data, replace fields if provided
    const result = await prisma.$transaction(async (tx) => {
      // Update basic scraper fields
      const updateData = {};
      if (name !== undefined) updateData.name = name;
      if (url !== undefined) updateData.url = url;
      if (urlPattern !== undefined) updateData.urlPattern = urlPattern;
      if (containerId !== undefined)
        updateData.containerId = containerId ? Number(containerId) : null;

      if (Object.keys(updateData).length > 0) {
        await tx.scraper.update({ where: { id }, data: updateData });
      }

      if (Array.isArray(fields)) {
        // remove existing fields and recreate the provided ones
        await tx.scraperField.deleteMany({ where: { scraperId: id } });
        if (fields.length > 0) {
          const createData = fields.map((f) => ({
            name: f.name,
            xpath: f.xpath,
            order: f.order || 0,
            scraperId: id,
          }));
          // createMany for bulk insert
          await tx.scraperField.createMany({ data: createData });
        }
      }

      return tx.scraper.findUnique({
        where: { id },
        include: { fields: true, container: true },
      });
    });

    return result;
  }

  async deleteScraper(scraperId) {
    const id = Number(scraperId);
    const result = await prisma.$transaction(async (tx) => {
      // delete related fields first
      await tx.scraperField.deleteMany({ where: { scraperId: id } });
      // delete the scraper
      const deleted = await tx.scraper.delete({ where: { id } });
      return deleted;
    });
    return result;
  }
}

module.exports = new ScraperService();
