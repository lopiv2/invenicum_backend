// services/mcpServer.js
// Servidor MCP de Invenicum — define las herramientas que Gemini puede invocar.
// Cada tool tiene: nombre, descripción (para que Gemini entienda cuándo usarla),
// parámetros (esquema JSON) y una función execute que hace el trabajo real.

const prisma = require("../middleware/prisma");
const axios = require("axios");
const cheerio = require("cheerio");
const { getBase64FromUrl } = require("../middleware/utils");

// ---------------------------------------------------------------------------
// DEFINICIONES DE TOOLS (lo que Gemini ve)
// ---------------------------------------------------------------------------

const TOOL_DEFINITIONS = [
  // ── Navegación ────────────────────────────────────────────────────────────
  {
    name: "navigate",
    description:
      "Navega a una sección de la app. Úsala cuando el usuario quiera ir a un lugar: " +
      "su inventario, préstamos, configuración, dashboard, preferencias, etc.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description:
            "Ruta de la app. Ejemplos: /dashboard, /settings, /integrations, " +
            "/container/{id}/asset-types, /container/{id}/loans",
        },
        reason: {
          type: "string",
          description:
            "Breve explicación de por qué navegas aquí (para el mensaje al usuario).",
        },
      },
      required: ["path"],
    },
  },

  // ── Escáner ───────────────────────────────────────────────────────────────
  {
    name: "open_scanner",
    description:
      "Abre el escáner de códigos de barras de la app. " +
      "Úsala cuando el usuario quiera escanear un producto o código QR.",
    parameters: {
      type: "object",
      properties: {},
      required: [],
    },
  },

  // ── Inventario: buscar ────────────────────────────────────────────────────
  {
    name: "search_assets",
    description:
      "Busca activos en el inventario del usuario por nombre. " +
      "Úsala cuando el usuario pregunte por un objeto concreto, quiera saber si tiene algo, " +
      "o pida listar elementos de su inventario.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Texto a buscar en el nombre de los activos.",
        },
        limit: {
          type: "number",
          description: "Máximo de resultados a devolver (por defecto 5).",
        },
      },
      required: ["query"],
    },
  },

  // ── Inventario: crear activo ──────────────────────────────────────────────
  {
    name: "create_asset",
    description:
      "Crea un nuevo activo en el inventario. " +
      "Úsala cuando el usuario quiera añadir un objeto a un contenedor/categoría específica. " +
      "Necesitas containerId, assetTypeId y locationId — búscalos primero si no los tienes.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "Nombre del activo." },
        description: { type: "string", description: "Descripción opcional." },
        containerId: { type: "number", description: "ID del contenedor." },
        assetTypeId: {
          type: "number",
          description: "ID del tipo de activo (categoría).",
        },
        locationId: { type: "number", description: "ID de la ubicación." },
        quantity: { type: "number", description: "Cantidad (por defecto 1)." },
      },
      required: ["name", "containerId", "assetTypeId", "locationId"],
    },
  },

  // ── Contenedores: listar ──────────────────────────────────────────────────
  {
    name: "list_containers",
    description:
      "Lista todos los contenedores del usuario con sus tipos de activo. " +
      "Úsala para obtener IDs cuando el usuario menciona un contenedor por nombre, " +
      "o cuando necesitas saber qué contenedores tiene.",
    parameters: {
      type: "object",
      properties: {},
      required: [],
    },
  },

  // ── Contenedores: crear ───────────────────────────────────────────────────
  {
    name: "create_container",
    description:
      "Crea un nuevo contenedor en el inventario del usuario. " +
      "Un contenedor agrupa categorías de activos (ej: 'Mi colección de cómics', 'Bodega').",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "Nombre del contenedor." },
        description: { type: "string", description: "Descripción opcional." },
        isCollection: {
          type: "boolean",
          description:
            "True si es una colección de objetos. Por defecto false.",
        },
      },
      required: ["name"],
    },
  },

  // ── Plantillas: crear ─────────────────────────────────────────────────────
  {
    name: "create_template",
    description:
      "Genera una plantilla de tipo de activo con campos personalizados. " +
      "Úsala cuando el usuario quiera organizar un tipo de colección nueva " +
      "(vinilos, libros, Funko Pops, herramientas, videojuegos, joyería, etc.). " +
      "OBLIGATORIO: siempre incluye entre 5 y 8 campos relevantes para ese tipo de objeto. " +
      "NUNCA invoques esta función con fields vacío [].",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "Nombre de la plantilla." },
        description: {
          type: "string",
          description: "Breve descripción de para qué sirve la plantilla.",
        },
        category: {
          type: "string",
          description: "Categoría (ej: Música, Libros, Juegos, Electrónica).",
        },
        fields: {
          type: "array",
          description:
            "OBLIGATORIO: Lista de campos del objeto. DEBE contener entre 5 y 8 campos relevantes. " +
            "Ejemplo para videojuegos: [{name:'Plataforma',type:'dropdown',options:['PS5','Xbox','PC','Switch']}, " +
            "{name:'Género',type:'dropdown',options:['Acción','RPG','Deportes','Estrategia']}, " +
            "{name:'Estado',type:'dropdown',options:['Nuevo','Usado','Digital']}, " +
            "{name:'Año de lanzamiento',type:'number'}, " +
            "{name:'Precio de compra',type:'price'}, " +
            "{name:'Completado',type:'boolean'}, " +
            "{name:'Puntuación personal',type:'number'}]. " +
            "NUNCA dejes este array vacío.",
          minItems: 4,
          items: {
            type: "object",
            properties: {
              name: {
                type: "string",
                description:
                  "Nombre descriptivo del campo. Ej: 'Plataforma', 'Año de lanzamiento'.",
              },
              type: {
                type: "string",
                enum: [
                  "text",
                  "number",
                  "date",
                  "dropdown",
                  "price",
                  "boolean",
                  "url",
                ],
                description:
                  "Tipo del campo. Usa 'dropdown' para listas cerradas de opciones, " +
                  "'price' para valores monetarios, 'boolean' para sí/no, 'number' para cantidades.",
              },
              options: {
                type: "array",
                items: { type: "string" },
                description:
                  "OBLIGATORIO si type es 'dropdown'. Lista de 3-6 opciones posibles. " +
                  "Ej: ['Nuevo', 'Usado', 'Dañado'].",
              },
            },
            required: ["name", "type"],
          },
        },
      },
      required: ["name", "fields"],
    },
  },

  // ── Extracción de producto desde URL ─────────────────────────────────────
  {
    name: "extract_product_from_url",
    description:
      "Extrae información de un producto desde una URL web (nombre, descripción, imagen, precio). " +
      "Úsala cuando el usuario comparta un enlace y quiera guardar ese producto en su inventario.",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "URL del producto a analizar." },
      },
      required: ["url"],
    },
  },
];

// ---------------------------------------------------------------------------
// IMPLEMENTACIONES DE TOOLS (lo que realmente ejecuta el código)
// ---------------------------------------------------------------------------

async function executeTool(toolName, toolArgs, context) {
  const {
    userId,
    locale = "es",
    geminiClient,
    geminiModel,
    aiClient,
    aiModel,
    aiProvider,
  } = context;

  switch (toolName) {
    // ── navigate ────────────────────────────────────────────────────────────
    case "navigate": {
      return {
        action: "NAVIGATE",
        data: { path: toolArgs.path },
      };
    }

    // ── open_scanner ─────────────────────────────────────────────────────────
    case "open_scanner": {
      return { action: "OPEN_SCANNER", data: {} };
    }

    // ── search_assets ────────────────────────────────────────────────────────
    case "search_assets": {
      const limit = toolArgs.limit || 5;
      const assets = await prisma.inventoryItem.findMany({
        where: {
          container: { userId },
          name: { contains: toolArgs.query },
        },
        include: {
          container: { select: { name: true } },
          assetType: { select: { name: true } },
          location: { select: { name: true } },
        },
        take: limit,
      });

      return {
        action: null,
        toolResult: assets.map((a) => ({
          id: a.id,
          name: a.name,
          container: a.container.name,
          category: a.assetType.name,
          location: a.location?.name ?? "Sin ubicación",
          quantity: a.quantity,
        })),
      };
    }

    // ── create_asset ─────────────────────────────────────────────────────────
    case "create_asset": {
      const newAsset = await prisma.inventoryItem.create({
        data: {
          name: toolArgs.name,
          description: toolArgs.description ?? null,
          quantity: toolArgs.quantity ?? 1,
          minStock: 0,
          condition: "loose",
          customFieldValues: {},
          container: { connect: { id: toolArgs.containerId } },
          assetType: { connect: { id: toolArgs.assetTypeId } },
          location: { connect: { id: toolArgs.locationId } },
        },
      });

      return {
        action: "NAVIGATE",
        data: {
          path: `/container/${toolArgs.containerId}/asset-types/${toolArgs.assetTypeId}/assets/${newAsset.id}`,
        },
        toolResult: { id: newAsset.id, name: newAsset.name },
      };
    }

    // ── list_containers ──────────────────────────────────────────────────────
    case "list_containers": {
      const containers = await prisma.container.findMany({
        where: { userId },
        include: {
          assetTypes: {
            select: { id: true, name: true },
          },
        },
      });

      return {
        action: null,
        toolResult: containers.map((c) => ({
          id: c.id,
          name: c.name,
          assetTypes: c.assetTypes,
        })),
      };
    }

    // ── create_container ─────────────────────────────────────────────────────
    case "create_container": {
      const container = await prisma.container.create({
        data: {
          name: toolArgs.name,
          description: toolArgs.description ?? "",
          isCollection: toolArgs.isCollection ?? false,
          userId,
        },
      });

      return {
        action: "NAVIGATE",
        data: { path: `/container/${container.id}/asset-types` },
        toolResult: { id: container.id, name: container.name },
      };
    }

    // ── create_template ──────────────────────────────────────────────────────
    case "create_template": {
      console.log(
        "[MCP create_template] toolArgs recibidos:",
        JSON.stringify(toolArgs, null, 2),
      );
      let fields = toolArgs.fields ?? [];

      // Si hay campos dropdown sin opciones, hacemos un segundo llamado a Gemini
      // para rellenarlas automáticamente — igual que en el aiService original.
      const dropdownsWithoutOptions = fields.filter(
        (f) => f.type === "dropdown" && (!f.options || f.options.length === 0),
      );

      const templateClient = geminiClient || aiClient;
      const templateModel = geminiModel || aiModel;
      if (dropdownsWithoutOptions.length > 0 && templateClient) {
        const fieldNames = dropdownsWithoutOptions
          .map((f) => `"${f.name}"`)
          .join(", ");
        const optionsPrompt =
          `Para una plantilla llamada "${toolArgs.name}" de categoría "${toolArgs.category ?? "General"}", ` +
          `sugiere entre 3 y 6 opciones realistas para cada uno de estos campos dropdown: ${fieldNames}. ` +
          `Responde ÚNICAMENTE con un objeto JSON donde cada clave es el nombre exacto del campo ` +
          `y el valor es un array de strings. Ejemplo: { "Estado": ["Nuevo", "Usado", "Dañado"] }`;

        try {
          const optionsResponse = await templateClient.models.generateContent({
            model: templateModel,
            contents: [{ role: "user", parts: [{ text: optionsPrompt }] }],
            config: {
              generationConfig: { responseMimeType: "application/json" },
            },
          });

          const optionsRaw =
            optionsResponse.candidates[0].content.parts[0].text;
          const optionsMap = JSON.parse(
            optionsRaw.replace(/```json|```/g, "").trim(),
          );

          fields = fields.map((f) => {
            if (f.type === "dropdown" && optionsMap[f.name]) {
              return { ...f, options: optionsMap[f.name] };
            }
            return f;
          });

          console.log(
            "[MCP create_template] Opciones inyectadas:",
            JSON.stringify(
              fields.filter((f) => f.type === "dropdown"),
              null,
              2,
            ),
          );
        } catch (e) {
          console.error(
            "[MCP create_template] Error obteniendo opciones:",
            e.message,
          );
          // No bloqueamos — devolvemos la plantilla sin opciones si falla
        }
      }

      return {
        action: "CREATE_TEMPLATE",
        data: {
          name: toolArgs.name,
          description: toolArgs.description ?? "",
          category: toolArgs.category ?? "",
          fields,
        },
      };
    }

    // ── extract_product_from_url ─────────────────────────────────────────────
    case "extract_product_from_url": {
      const { data: html } = await axios.get(toolArgs.url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        },
        timeout: 10000,
      });

      const $ = cheerio.load(html);
      const baseUrl = new URL(toolArgs.url);

      // 1. Extraer metadatos enriquecidos (OpenGraph, Schema.org, JSON-LD)
      let ogImage =
        $('meta[property="og:image"]').attr("content") ||
        $('meta[name="twitter:image"]').attr("content");
      if (ogImage && ogImage.startsWith("/"))
        ogImage = `${baseUrl.origin}${ogImage}`;

      // Capturamos bloques JSON-LD (donde suele estar el EAN/Barcode y la Marca)
      const jsonLdData = [];
      $('script[type="application/ld+json"]').each((i, el) => {
        try {
          jsonLdData.push($(el).html());
        } catch (_) {}
      });

      // Limpieza del HTML para el texto visible
      $("script, style, nav, footer, header, aside, noscript").remove();
      const cleanText = $("body")
        .text()
        .replace(/\s+/g, " ")
        .trim()
        .substring(0, 20000);

      const activeClient = geminiClient || aiClient;
      const activeModel = geminiModel || aiModel;

      const extractResponse = await activeClient.models.generateContent({
        model: activeModel,
        contents: [
          {
            role: "user",
            parts: [
              {
                text: `Analiza el contenido de esta URL y extrae la mayor cantidad de información técnica del producto.
        
        URL: ${toolArgs.url}
        Imagen sugerida: ${ogImage ?? "null"}
        Metadatos extra: ${jsonLdData.join(" ")}
        Texto visible: ${cleanText}

        Busca específicamente: nombre, descripción detallada, precio, moneda, imagen (URL), código de barras (EAN/GTIN/UPC), marca (brand), categoría y dimensiones si existen.

        Responde ESTRICTAMENTE con este formato JSON:
        {
          "name": "nombre del producto",
          "description": "descripción resumida",
          "imageUrl": "URL de la mejor imagen",
          "price": 0.0,
          "currency": "EUR/USD/etc",
          "barcode": "número de código de barras o null",
          "brand": "marca del producto",
          "category": "categoría",
          "specifications": { "campo": "valor" }
        }`,
              },
            ],
          },
        ],
        config: { generationConfig: { responseMimeType: "application/json" } },
      });

      let extracted = JSON.parse(
        extractResponse.candidates[0].content.parts[0].text
          .replace(/```json|```/g, "")
          .trim(),
      );

      if (Array.isArray(extracted)) extracted = extracted[0] ?? {};

      // 2. Intentar convertir a Base64 si hay imagen
      if (extracted.imageUrl?.startsWith("http")) {
        try {
          extracted.imageUrl = await getBase64FromUrl(extracted.imageUrl);
        } catch (_) {}
      }

      return {
        action: "PRODUCT_EXTRACT",
        data: extracted, // Ahora contiene barcode, brand, etc.
      };
    }

    default:
      throw new Error(`Tool desconocida: ${toolName}`);
  }
}

module.exports = { TOOL_DEFINITIONS, executeTool };
