const Joi = require("joi");

const pluginSchema = Joi.object({
  // Definimos only lo mínimo necesario so that sea a plugin válido
  name: Joi.string().required(),
  slot: Joi.string().required(),
  ui: Joi.object().required(),
}).unknown(true);

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
