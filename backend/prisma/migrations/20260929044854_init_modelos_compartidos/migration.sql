-- CreateTable
CREATE TABLE "Viaje" (
    "id" TEXT NOT NULL,
    "destino" TEXT NOT NULL,
    "tipoViaje" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "presupuesto" DOUBLE PRECISION NOT NULL,
    "transporte" TEXT NOT NULL,
    "intereses" TEXT[],
    "fechaInicio" TIMESTAMP(3) NOT NULL,
    "fechaFin" TIMESTAMP(3) NOT NULL,
    "hospedaje" BOOLEAN NOT NULL,
    "nombreHotel" TEXT,

    CONSTRAINT "Viaje_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Itinerario" (
    "id" TEXT NOT NULL,
    "viajeId" TEXT NOT NULL,
    "numeroDia" INTEGER NOT NULL,
    "fecha" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Itinerario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Parada" (
    "id" TEXT NOT NULL,
    "itinerarioId" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "horaApertura" TEXT NOT NULL,
    "horaCierre" TEXT NOT NULL,
    "tiempoEstanciaMinutos" INTEGER NOT NULL,

    CONSTRAINT "Parada_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Restriccion" (
    "id" TEXT NOT NULL,
    "paradaId" TEXT NOT NULL,
    "tipoEntorno" TEXT NOT NULL,
    "sensibilidadClima" TEXT NOT NULL,

    CONSTRAINT "Restriccion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Restriccion_paradaId_key" ON "Restriccion"("paradaId");

-- AddForeignKey
ALTER TABLE "Itinerario" ADD CONSTRAINT "Itinerario_viajeId_fkey" FOREIGN KEY ("viajeId") REFERENCES "Viaje"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Parada" ADD CONSTRAINT "Parada_itinerarioId_fkey" FOREIGN KEY ("itinerarioId") REFERENCES "Itinerario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Restriccion" ADD CONSTRAINT "Restriccion_paradaId_fkey" FOREIGN KEY ("paradaId") REFERENCES "Parada"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
