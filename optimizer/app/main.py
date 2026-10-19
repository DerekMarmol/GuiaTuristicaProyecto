from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routers import health, optimize

from app.config import settings
from app.routers import health
from app.services.valhalla import cerrar_cliente_valhalla


@asynccontextmanager
async def lifespan(_app: FastAPI):
    yield
    cerrar_cliente_valhalla()


app = FastAPI(title=settings.app_name, debug=settings.debug, lifespan=lifespan)
app.include_router(health.router)
app.include_router(optimize.router)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router)