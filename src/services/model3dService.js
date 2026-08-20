const fs = require("fs");
const path = require("path");
const prisma = require("../middleware/prisma");
const { getPublicUrl } = require("../middleware/upload");

const BASE_DIR = process.env.UPLOAD_FOLDER || "uploads/inventory";
const MODEL_DIR = path.resolve(
  process.cwd(),
  process.env.MODEL_3D_ROOT || path.join(BASE_DIR, "models3d"),
);

const MAX_SIZE_MB = parseInt(process.env.MODEL_3D_MAX_SIZE_MB, 10) || 50;
const MAX_SIZE = MAX_SIZE_MB * 1024 * 1024;

if (!fs.existsSync(MODEL_DIR)) {
  fs.mkdirSync(MODEL_DIR, { recursive: true });
}

function assertGlbFile(file) {
  if (!file || path.extname(file.originalname).toLowerCase() !== ".glb") {
    throw new Error("Solo se permiten modelos GLB.");
  }

  if (file.size > MAX_SIZE) {
    throw new Error(
      `El modelo GLB supera el límite de ${MAX_SIZE_MB} MB.`,
    );
  }

  const header = Buffer.alloc(4);
  const descriptor = fs.openSync(file.path, "r");
  try {
    fs.readSync(descriptor, header, 0, 4, 0);
  } finally {
    fs.closeSync(descriptor);
  }

  if (header.toString("ascii") !== "glTF") {
    throw new Error("El archivo no contiene un GLB válido.");
  }
}

async function getOwnedItem(itemId, userId) {
  const item = await prisma.inventoryItem.findFirst({
    where: {
      id: parseInt(itemId),
      container: { userId: parseInt(userId) },
    },
    include: { assetType: true },
  });

  if (!item) throw new Error("Activo no encontrado o acceso denegado.");
  if (item.assetType.kind !== "gallery3d") {
    throw new Error("El tipo de activo no está configurado como galería 3D.");
  }
  return item;
}

async function addUploadedModel(itemId, userId, file, order = 0) {
  await getOwnedItem(itemId, userId);
  assertGlbFile(file);

  const relativePath = path.relative(MODEL_DIR, file.path).replace(/\\/g, "/");
  const model = await prisma.inventoryItemModel3D.create({
    data: {
      sourceType: "upload",
      relativePath,
      url: getPublicUrl(file.path),
      filename: file.filename,
      originalName: file.originalname,
      mimeType: "model/gltf-binary",
      size: file.size,
      order: parseInt(order) || 0,
      inventoryItemId: parseInt(itemId),
    },
  });

  return model;
}

async function addServerModel(itemId, userId, requestedPath, order = 0) {
  await getOwnedItem(itemId, userId);

  if (typeof requestedPath !== "string" || !requestedPath.toLowerCase().endsWith(".glb")) {
    throw new Error("La ruta debe apuntar a un archivo GLB.");
  }

  const normalized = path.normalize(requestedPath).replace(/\\/g, "/");
  if (path.isAbsolute(normalized) || normalized.startsWith("../")) {
    throw new Error("La ruta del modelo no es válida.");
  }

  const absolutePath = path.resolve(MODEL_DIR, normalized);
  if (!absolutePath.startsWith(`${MODEL_DIR}${path.sep}`) || !fs.existsSync(absolutePath)) {
    throw new Error("El modelo GLB no existe dentro del directorio permitido.");
  }

  const header = Buffer.alloc(4);
  const descriptor = fs.openSync(absolutePath, "r");
  try {
    fs.readSync(descriptor, header, 0, 4, 0);
  } finally {
    fs.closeSync(descriptor);
  }
  if (header.toString("ascii") !== "glTF") {
    throw new Error("El archivo no contiene un GLB válido.");
  }

  const relativePath = path.relative(
    path.resolve(process.cwd(), BASE_DIR),
    absolutePath,
  ).replace(/\\/g, "/");

  return prisma.inventoryItemModel3D.create({
    data: {
      sourceType: "serverPath",
      relativePath,
      url: getPublicUrl(absolutePath),
      filename: path.basename(absolutePath),
      originalName: path.basename(absolutePath),
      mimeType: "model/gltf-binary",
      size: fs.statSync(absolutePath).size,
      order: parseInt(order) || 0,
      inventoryItemId: parseInt(itemId),
    },
  });
}

async function deleteModel(modelId, userId) {
  const model = await prisma.inventoryItemModel3D.findFirst({
    where: {
      id: parseInt(modelId),
      inventoryItem: { container: { userId: parseInt(userId) } },
    },
  });
  if (!model) throw new Error("Modelo 3D no encontrado o acceso denegado.");

  await prisma.inventoryItemModel3D.delete({ where: { id: model.id } });
  if (model.sourceType === "upload" && model.filename) {
    const filePath = path.resolve(MODEL_DIR, model.filename);
    if (filePath.startsWith(`${MODEL_DIR}${path.sep}`) && fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }
}

module.exports = {
  MODEL_DIR,
  MAX_SIZE,
  MAX_SIZE_MB,
  addUploadedModel,
  addServerModel,
  deleteModel,
};
