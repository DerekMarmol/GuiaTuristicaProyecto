export interface Usuario {
  id: string;
  nombre: string;
  correo: string;
}

export interface RespuestaAuth {
  usuario: Usuario;
  token: string;
}