class CrossToonDTO {
  constructor(prismaRow) {
    this.id = prismaRow.id;
    this.isDefault = prismaRow.isDefault ?? false;
    this.imagePath = prismaRow.imagePath;
    this.speed = prismaRow.speed;
    this.direction = prismaRow.direction;
    this.frequency = prismaRow.frequency;
    this.zone = prismaRow.zone;
    this.imageSize = prismaRow.imageSize;
    this.turnMode = prismaRow.turnMode;
    this.turnMinDelay = prismaRow.turnMinDelay;
    this.turnMaxDelay = prismaRow.turnMaxDelay;
    this.maxTurns = prismaRow.maxTurns;
    this.animationFps = prismaRow.animationFps;
    this.enabled = prismaRow.enabled ?? true;
  }

  static fromFormData(body) {
    const data = {};
    if (body.speed !== undefined) data.speed = parseInt(body.speed, 10);
    if (body.direction !== undefined) data.direction = body.direction;
    if (body.frequency !== undefined) data.frequency = parseInt(body.frequency, 10);
    if (body.zone !== undefined) data.zone = body.zone;
    if (body.imageSize !== undefined) data.imageSize = parseFloat(body.imageSize);
    if (body.turnMode !== undefined) data.turnMode = body.turnMode;
    if (body.turnMinDelay !== undefined) data.turnMinDelay = parseInt(body.turnMinDelay, 10);
    if (body.turnMaxDelay !== undefined) data.turnMaxDelay = parseInt(body.turnMaxDelay, 10);
    if (body.maxTurns !== undefined) data.maxTurns = parseInt(body.maxTurns, 10);
    if (body.animationFps !== undefined) data.animationFps = parseInt(body.animationFps, 10);
    if (body.enabled !== undefined) data.enabled = body.enabled === true || body.enabled === "true";
    return data;
  }

  toJSON() {
    return {
      id: this.id,
      isDefault: this.isDefault,
      imagePath: this.imagePath,
      speed: this.speed,
      direction: this.direction,
      frequency: this.frequency,
      zone: this.zone,
      imageSize: this.imageSize,
      turnMode: this.turnMode,
      turnMinDelay: this.turnMinDelay,
      turnMaxDelay: this.turnMaxDelay,
      maxTurns: this.maxTurns,
      animationFps: this.animationFps,
      enabled: this.enabled,
    };
  }
}

module.exports = CrossToonDTO;
