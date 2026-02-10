const Joi = require("joi");

const pluginSchema = Joi.object({
  id: Joi.string().optional(), // 👈 Añade esto para que no explote si viene el ID
  name: Joi.string().min(3).max(50).required(),
  slot: Joi.string().required(),
  ui: Joi.object().min(1).required(),
  description: Joi.string().allow("", null),
  isPublic: Joi.boolean(),
  isActive: Joi.boolean().default(true),
});

const validatePlugin = (req, res, next) => {
  const { error } = pluginSchema.validate(req.body, { abortEarly: false });

  if (error) {
    const errorMessages = error.details.map((detail) => detail.message);
    return res.status(400).json({
      success: false,
      message: "Error de validación",
      errors: errorMessages,
    });
  }
  next();
};

module.exports = { validatePlugin };
