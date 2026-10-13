/*
  Warnings:

  - A unique constraint covering the columns `[viajeId,numeroDia]` on the table `Itinerario` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[codigoCompartido]` on the table `Viaje` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `actualizadoEn` to the `Viaje` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "Itinerario" DROP CONSTRAINT "Itinerario_viajeId_fkey";

-- DropForeignKey
ALTER TABLE "Parada" DROP CONSTRAINT "Parada_itinerarioId_fkey";

-- DropForeignKey
ALTER TABLE "Restriccion" DROP CONSTRAINT "Restriccion_paradaId_fkey";

-- AlterTable
ALTER TABLE "Viaje" ADD COLUMN     "actualizadoEn" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "codigoCompartido" TEXT,
ADD COLUMN     "esPublico" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE UNIQUE INDEX "Itinerario_viajeId_numeroDia_key" ON "Itinerario"("viajeId", "numeroDia");

-- CreateIndex
CREATE UNIQUE INDEX "Viaje_codigoCompartido_key" ON "Viaje"("codigoCompartido");

-- CreateIndex
CREATE INDEX "Viaje_codigoCompartido_idx" ON "Viaje"("codigoCompartido");

-- AddForeignKey
ALTER TABLE "Itinerario" ADD CONSTRAINT "Itinerario_viajeId_fkey" FOREIGN KEY ("viajeId") REFERENCES "Viaje"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Parada" ADD CONSTRAINT "Parada_itinerarioId_fkey" FOREIGN KEY ("itinerarioId") REFERENCES "Itinerario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Restriccion" ADD CONSTRAINT "Restriccion_paradaId_fkey" FOREIGN KEY ("paradaId") REFERENCES "Parada"("id") ON DELETE CASCADE ON UPDATE CASCADE;
