import OfflineBanner from "./components/OfflineBanner";

export default function App() {
  return (
    <>
      <div className="fondo" aria-hidden="true">
        <div className="sol" />
        <div className="rejilla" />
      </div>
      <OfflineBanner />
      <header className="app-header">
        <span className="logo">GUÍA TURÍSTICA</span>
      </header>
      <main className="contenedor">
        <section className="card">
          <p className="eyebrow">PWA lista</p>
          <h1>
            Planea tu <span className="neon">viaje</span>
          </h1>
          <p>La PWA está configurada. Aquí irá el flujo para crear tu itinerario paso a paso.</p>
          <button type="button" className="btn-primario">Comenzar</button>
        </section>
      </main>
    </>
  );
}