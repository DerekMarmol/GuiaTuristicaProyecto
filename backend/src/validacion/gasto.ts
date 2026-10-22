import { z } from "zod";

export const CATEGORIAS_GASTO = [
  "comidas",
  "entradas",
  "transporte",
  "hospedaje",
  "otros",
] as const;

export const esquemaCrearGasto = z.object({
  monto: z
    .number({ invalid_type_error: "El monto debe ser un número." })
    .positive("El monto debe ser mayor a cero."),
  categoria: z.enum(CATEGORIAS_GASTO, {
    errorMap: () => ({
      message: "Categoría no válida. Debe ser: comidas, entradas, transporte, hospedaje u otros.",
    }),
  }),
  paradaId: z.string().uuid("El ID de la parada debe ser un UUID válido.").optional().nullable(),
  descripcion: z.string().max(255, "La descripción no puede superar los 255 caracteres.").optional().nullable(),
});

export type DatosCrearGasto = z.infer<typeof esquemaCrearGasto>;