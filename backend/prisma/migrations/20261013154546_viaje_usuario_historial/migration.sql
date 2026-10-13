-- AlterTable
ALTER TABLE "Viaje" ADD COLUMN     "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "estado" TEXT NOT NULL DEFAULT 'en_curso',
ADD COLUMN     "usuarioId" TEXT;

-- CreateIndex
CREATE INDEX "Viaje_usuarioId_creadoEn_idx" ON "Viaje"("usuarioId", "creadoEn");

-- AddForeignKey
ALTER TABLE "Viaje" ADD CONSTRAINT "Viaje_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

