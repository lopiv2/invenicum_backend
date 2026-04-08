// services/mcpServer.js
// Invenicum MCP server — defines the tools that Gemini can invoke.
// Each tool has: name, description (so Gemini understands when to use it),
// parameters (JSON schema), and an execute function that does the real work.

const prisma = require("../middleware/prisma");
const axios = require("axios");
const cheerio = require("cheerio");
const { getBase64FromUrl } = require("../middleware/utils");

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// TOOL DEFINITIONS (what Gemini sees)
// ---------------------------------------------------------------------------

const TOOL_DEFINITIONS = [
  // ── Navegación ────────────────────────────────────────────────────────────
  {
    name: "navigate",
    description:
      "Navega a una sección de la app. Úsala cuando el usuario quiera ir a un lugar: " +
      "your inventory, loans, settings, dashboard, preferences, etc.",
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

  // ── Scanner ───────────────────────────────────────────────────────────────
  {
    name: "open_scanner",
    description:
      "Open the app's barcode scanner. " +
      "Úsala cuando el usuario quiera escanear un producto o código QR.",
    parameters: {
      type: "object",
      properties: {},
      required: [],
    },
  },

  // ── Inventory: Search ────────────────────────────────────────────────────
  {
    name: "search_assets",
    description:
      "Search user inventory assets by name. " +
      "Úsala cuando el usuario pregunte por un objeto concreto, quiera saber si tiene algo, " +
      "or ask to list items in your inventory.",
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

  // ── Inventory: Create asset ──────────────────────────────────────────────
  {
    name: "create_asset",
    description:
      "Create a new asset in the inventory. " +
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

  // ── Containers: List ──────────────────────────────────────────────────
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

  // ── Containers: Create ───────────────────────────────────────────────────
  {
    name: "create_container",
    description:
      "Create a new container in the user's inventory. " +
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

  // ── Templates: Create ─────────────────────────────────────────────────────
  {
    name: "create_template",
    description:
      "Generate an asset type template with custom fields. " +
      "Úsala cuando el usuario quiera organizar un tipo de colección nueva " +
      "(vinilos, libros, Funko Pops, herramientas, videojuegos, joyería, etc.). " +
      "OBLIGATORIO: siempre incluye entre 5 y 8 campos relevantes para ese tipo de objeto. " +
      "NUNCA invoques esta función con fields vacío [].",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "Template name." },
        description: {
          type: "string",
          description: "Brief description of what the template is for.",
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

  // ── Product Extraction from URL ─────────────────────────────────────
  {
    name: "extract_product_from_url",
    description:
      "Extracts product information from a web URL (name, description, image, price). " +
      "Use this when the user shares a link and wants to save that product in their inventory.",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "URL of the product to analyze." },
      },
      required: ["url"],
    },
  },
];

// ---------------------------------------------------------------------------
// TOOL IMPLEMENTATIONS (what actually executes the code)
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

    // ── Navigation ───────────────────────────────────────────────────────────
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
        take: limit,
        include: {
          container: { select: { name: true } },
          assetType: { select: { name: true } },
          location: { select: { name: true } },
        },
      });

      return {
        action: null,
        toolResult: assets.map((a) => ({
          id: a.id,
          name: a.name,
          container: a.container.name,
          category: a.assetType.name,
          location: a.location?.name ?? null,
        })),
      };
    }

    // ── create_asset ──────────────────────────────────────────────────────────
    case "create_asset": {
      const newAsset = await prisma.inventoryItem.create({
        data: {
          name: toolArgs.name,
          description: toolArgs.description ?? "",
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

    // ── create_container ──────────────────────────────────────────────────────
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

    // ── create_template ───────────────────────────────────────────────────────
    case "create_template": {
      console.log(
        "[MCP create_template] toolArgs recibidos:",
        JSON.stringify(toolArgs, null, 2),
      );
      const allowedTypes = new Set([
        "text",
        "number",
        "date",
        "dropdown",
        "price",
        "boolean",
        "url",
      ]);

      if (!Array.isArray(toolArgs.fields)) {
        throw new Error("create_template requires the fields parameter as an array.");
      }

      if (toolArgs.fields.length < 5 || toolArgs.fields.length > 8) {
        throw new Error("create_template requires between 5 and 8 fields.");
      }

      const fields = toolArgs.fields.map((rawField, index) => {
        if (!rawField || typeof rawField !== "object") {
          throw new Error(`Field #${index + 1} is not a valid object.`);  
        }

        const name = String(rawField.name ?? "").trim();
        if (!name) {
          throw new Error(`Field #${index + 1} requires a name.`);
        }

        const type = String(rawField.type ?? "").toLowerCase().trim();
        if (!allowedTypes.has(type)) {
          throw new Error(
            `Field "${name}" has an invalid type: "${rawField.type}".`,
          );
        }

        if (type === "dropdown") {
          if (!Array.isArray(rawField.options)) {
            throw new Error(
              `Dropdown field "${name}" requires options (array).`,
            );
          }

          const options = rawField.options
            .map((o) => String(o ?? "").trim())
            .filter(Boolean);

          const uniqueOptions = [...new Set(options.map((o) => o.toLowerCase()))];
          if (uniqueOptions.length < 3 || uniqueOptions.length > 6) {
            throw new Error(
              `Dropdown field "${name}" must have between 3 and 6 options.`,
            );
          }

          return {
            name,
            type,
            options,
          };
        }

        return {
          name,
          type,
        };
      });

      return {
        action: "CREATE_TEMPLATE",
        data: {
          name: toolArgs.name,
          description: toolArgs.description ?? "",
          category: toolArgs.category ?? "",
          fields,
          fieldDefinitions: fields,
          templateData: {
            name: toolArgs.name,
            description: toolArgs.description ?? "",
            category: toolArgs.category ?? "",
            fields,
            fieldDefinitions: fields,
          },
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
      // Capture JSON-LD blocks (where EAN/Barcode and Brand are usually found)
      const jsonLdData = [];
      $('script[type="application/ld+json"]').each((i, el) => {
        try {
          jsonLdData.push($(el).html());
        } catch (_) {}
      });

      // Limpieza del HTML for the texto visible
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
                text: `Analyze the content of this URL and extract as much technical information about the product as possible.
        
        URL: ${toolArgs.url}
        Suggested image: ${ogImage ?? "null"}
        Extra metadata: ${jsonLdData.join(" ")}
        Visible text: ${cleanText}

        Specifically look for: name, detailed description, price, currency, image (URL), barcode (EAN/GTIN/UPC), brand, category, and dimensions if available.

        Respond STRICTLY in this JSON format:
        {
          "name": "product name",
          "description": "short description",
          "imageUrl": "URL of the best image representing the product",
          "price": 0.0,
          "currency": "EUR/USD/etc",
          "barcode": "product barcode or null",
          "brand": "product brand",
          "category": "product category",
          "specifications": { "field": "value" }
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

      // 2. Try to convert to Base64 if there is an image
      if (extracted.imageUrl?.startsWith("http")) {
        try {
          extracted.imageUrl = await getBase64FromUrl(extracted.imageUrl);
        } catch (_) {}
      }

      return {
        action: "PRODUCT_EXTRACT",
        data: extracted, // Now contains barcode, brand, etc.
      };
    }

    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}

module.exports = { TOOL_DEFINITIONS, executeTool };
