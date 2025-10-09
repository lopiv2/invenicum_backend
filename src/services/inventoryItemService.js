const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const path = require("path");
const fs = require("fs");
require("dotenv").config();

// 💡 Ruta Absoluta donde se guardan los archivos
// Asumimos que la carpeta 'uploads/inventory' está un nivel por encima del archivo de servicio
const UPLOAD_DIR_ABSOLUTE = path.join(
  __dirname,
  "..",
  process.env.UPLOAD_FOLDER
);

class InventoryItemService {
  async createItem(data) {
    // Extraemos los archivos y el resto de los datos del ítem
    const files = data.files || [];
    const itemData = { ...data };
    delete itemData.files; // Limpiamos files

    const containerId = parseInt(itemData.containerId);
    const assetTypeId = parseInt(itemData.assetTypeId);

    // 🛑 Limpiamos las IDs del objeto de datos para que Prisma no las rechace en el 'spread'.
    delete itemData.containerId;
    delete itemData.assetTypeId;

    if (isNaN(containerId) || isNaN(assetTypeId)) {
      // Usamos file.path aquí, ya que Multer lo proporciona en el contexto de la ruta.
      files.forEach((file) => fs.unlinkSync(file.path));
      throw new Error("Invalid Container ID or Asset Type ID.");
    }

    if (
      itemData.customFieldValues &&
      typeof itemData.customFieldValues === "string"
    ) {
      try {
        itemData.customFieldValues = JSON.parse(itemData.customFieldValues);
      } catch (e) {
        files.forEach((file) => fs.unlinkSync(file.path));
        throw new Error("Invalid JSON format for custom fields.");
      }
    }

    // 1. Mapear archivos a URLs públicas
    const baseImageUrl = process.env.STATIC_URL_PREFIX;
    const imageRelations = files.map((file, index) => {
      const publicUrl = path
        .join(baseImageUrl, file.filename)
        .replace(/\\/g, "/");
      return {
        url: publicUrl,
        // 🛑 'filename' NO existe en el modelo InventoryItemImage, así que NO se incluye.
        order: index,
      };
    });

    try {
      // 2. Crear el ítem y las imágenes dentro de una sola transacción de Prisma
      const newItem = await prisma.inventoryItem.create({
        data: {
          // 🔑 Usamos el spread solo para los campos directos que quedan (name, description, customFieldValues)
          ...itemData,

          // 🔑 Corregido: Usar 'connect' para las relaciones de Muchos a Uno (Container, AssetType)
          container: {
            connect: { id: containerId },
          },
          assetType: {
            connect: { id: assetTypeId },
          },

          // Conexión anidada para crear las imágenes
          images: {
            create: imageRelations,
          },
        },
        include: {
          images: {
            orderBy: { order: "asc" },
          },
        },
      });

      return { success: true, data: newItem };
    } catch (error) {
      console.error("Prisma error during item creation:", error);

      // 🔑 Corregido: Usamos la ruta absoluta centralizada para la limpieza
      files.forEach((file) => {
        // Reconstruimos la ruta: UPLOAD_DIR_ABSOLUTE + nombre del archivo generado por Multer
        const absolutePath = path.join(UPLOAD_DIR_ABSOLUTE, file.filename);
        try {
          fs.unlinkSync(absolutePath);
        } catch (err) {
          // Si falla la limpieza, registramos el error, pero no bloqueamos el error principal.
          console.error("Error cleaning up file:", err);
        }
      });

      throw new Error("Failed to create inventory item and associate images.");
    }
  }

  async getItems({ containerId, assetTypeId, userId }) {
    const items = await prisma.inventoryItem.findMany({
      where: {
        containerId,
        assetTypeId,
        container: {
          userId: userId,
        },
      },
      include: {
        images: {
          orderBy: { order: "asc" },
        },
      },
    });
    return { success: true, data: items };
  }

  async getItemById(id, containerId) {
    return prisma.inventoryItem.findFirst({
      where: {
        id,
        containerId,
      },
      include: {
        images: {
          orderBy: { order: "asc" },
        },
      },
    });
  }

  async updateItem(id, data) {
    // 1. Desestructurar y preparar los datos.
    const {
      imageIdsToDelete,
      filesToUpload,
      containerId: containerIdStr,
      assetTypeId: assetTypeIdStr,
      customFieldValues, // <-- Aquí viene como String JSON escapado
      ...updateData
    } = data;

    // 2. Conversión de tipos y limpieza.
    const itemIdInt = parseInt(id);
    const containerIdInt = parseInt(containerIdStr);
    const assetTypeIdInt = parseInt(assetTypeIdStr);

    if (isNaN(itemIdInt) || isNaN(containerIdInt) || isNaN(assetTypeIdInt)) {
      throw new Error(
        "Invalid ID format provided for item, container, or asset type."
      );
    }

    // 🚀 SOLUCIÓN CLAVE: Parsear customFieldValues
    let parsedCustomFieldValues = {};
    if (customFieldValues && typeof customFieldValues === "string") {
      try {
        // Intentamos parsear el string JSON escapado que viene del frontend
        parsedCustomFieldValues = JSON.parse(customFieldValues);
      } catch (e) {
        console.error("Error parsing customFieldValues:", e);
        throw new Error("Invalid JSON format for custom field values.");
      }
    }

    const updateActions = [];

    // ===========================================
    // PASO A: ELIMINACIÓN DE IMÁGENES (DB y Disco)
    // ===========================================
    if (imageIdsToDelete && imageIdsToDelete.length > 0) {
      // Asegurar que imageIdsToDelete sea un array de Int (Multer lo convierte a String)
      const idsToDeleteInt = imageIdsToDelete
        .map((id) => parseInt(id))
        .filter((id) => !isNaN(id));

      // 1. Encontrar las URLs de las imágenes que vamos a eliminar
      const imagesToDelete = await prisma.inventoryItemImage.findMany({
        where: {
          id: { in: idsToDeleteInt },
          inventoryItemId: itemIdInt,
        },
        select: { url: true },
      });

      // 2. Eliminar las imágenes del disco
      for (const img of imagesToDelete) {
        const filename = path.basename(img.url);
        const imagePath = path.join(UPLOAD_DIR, filename);

        try {
          if (fs.existsSync(imagePath)) {
            fs.unlinkSync(imagePath);
          }
        } catch (err) {
          console.error(`Error deleting file ${imagePath}:`, err);
        }
      }

      // 3. Eliminar las referencias de la base de datos
      updateActions.push(
        prisma.inventoryItemImage.deleteMany({
          where: {
            id: { in: idsToDeleteInt },
            inventoryItemId: itemIdInt,
          },
        })
      );
    }

    // ===========================================
    // PASO B: ACTUALIZAR EL ITEM PRINCIPAL
    // ===========================================
    updateActions.push(
      prisma.inventoryItem.update({
        where: {
          id: itemIdInt,
          containerId: containerIdInt,
        },
        data: {
          ...updateData,
          containerId: containerIdInt,
          assetTypeId: assetTypeIdInt,
          // 🚀 USAMOS EL OBJETO PARSEADO (Formato correcto para Prisma)
          customFieldValues: parsedCustomFieldValues,
        },
        include: {
          images: {
            orderBy: { order: "asc" },
          },
        },
      })
    );

    // ===========================================
    // PASO C: AÑADIR NUEVAS IMÁGENES
    // ===========================================
    if (filesToUpload && filesToUpload.length > 0) {
      const lastImage = await prisma.inventoryItemImage.findFirst({
        where: { inventoryItemId: itemIdInt },
        orderBy: { order: "desc" },
        select: { order: true },
      });
      const startOrder = lastImage ? lastImage.order + 1 : 1;

      const baseImageUrl = process.env.STATIC_URL_PREFIX;
      const UPLOAD_WEB_PATH = "/"; // 🔑 Usamos la ruta relativa correcta

      const newImagesData = filesToUpload.map((file, index) => {
        // 🔑 CORRECCIÓN: Unimos STATIC_URL_PREFIX con la ruta web /images/ y el nombre del archivo.
        // path.join() maneja las barras de forma segura, pero lo forzamos a usar '/' al final.
        const publicUrl = path
          .join(baseImageUrl, UPLOAD_WEB_PATH, file.filename)
          .replace(/\\/g, "/");

        return {
          url: publicUrl,
          inventoryItemId: itemIdInt,
          order: startOrder + index,
        };
      });

      updateActions.push(
        prisma.inventoryItemImage.createMany({
          data: newImagesData,
        })
      );
    }

    // ===========================================
    // PASO D: EJECUTAR TRANSACCIÓN Y DEVOLVER EL RESULTADO FINAL
    // ===========================================

    const results = await prisma.$transaction(updateActions);

    // Encuentra el resultado de la actualización del ítem principal para devolverlo
    const updatedItemResult = results.find(
      (res) => typeof res === "object" && res.id === itemIdInt
    );

    if (updatedItemResult) {
      // Asegura que devolvemos el ítem con las relaciones actualizadas
      return prisma.inventoryItem.findUnique({
        where: { id: itemIdInt },
        include: { images: { orderBy: { order: "asc" } } },
      });
    }

    throw new Error(
      "Update failed or the item could not be retrieved after update."
    );
  }

  // ----------------------------------------------------
  // 🔑 MÉTODO DE ELIMINACIÓN CON BORRADO DE ARCHIVOS
  // ----------------------------------------------------
  async deleteItem(itemId, userId) {
    // 1. Encontrar el ítem para obtener las URLs de las imágenes
    const itemToDelete = await prisma.inventoryItem.findFirst({
      where: {
        id: itemId,
        container: {
          userId: userId, // Verificar la propiedad
        },
      },
      // 💡 Incluir las imágenes es FUNDAMENTAL
      include: {
        images: true,
      },
    });

    if (!itemToDelete) {
      throw new Error("Item not found or access denied.");
    }

    // 2. BORRAR ARCHIVOS DEL DISCO
    if (itemToDelete.images && itemToDelete.images.length > 0) {
      for (const image of itemToDelete.images) {
        // Asumimos que el campo `filename` o el nombre del archivo está en la DB
        // Si no está, lo extraemos de la URL:
        const filename = path.basename(image.url);
        const absolutePath = path.join(UPLOAD_DIR_ABSOLUTE, filename);

        try {
          if (fs.existsSync(absolutePath)) {
            fs.unlinkSync(absolutePath); // 🔑 ¡Borra el archivo físico!
            console.log(`Successfully deleted file: ${absolutePath}`);
          }
        } catch (err) {
          console.error(`Error deleting file ${absolutePath}:`, err);
          // Si falla el borrado del archivo, no impedimos la eliminación de la DB.
        }
      }
    }

    // 3. BORRAR REGISTRO DE LA BASE DE DATOS
    // Usamos `delete` en el registro específico. Si el esquema tiene
    // `ON DELETE CASCADE` en la relación de imágenes, la eliminación de la DB
    // también borrará automáticamente los registros de `InventoryItemImage`.
    try {
      await prisma.inventoryItem.delete({
        where: { id: itemId },
      });
    } catch (error) {
      console.error("Prisma error during item deletion:", error);
      throw new Error("Failed to delete inventory item from database.");
    }

    return { success: true };
  }

  async updateItemOptions(id, containerId, options) {
    return prisma.inventoryItem.update({
      where: {
        id,
        containerId,
      },
      data: {
        options,
      },
    });
  }
}

module.exports = new InventoryItemService();
