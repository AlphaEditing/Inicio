# Alpha Visual Studio — Plataforma web

Agencia digital (Jaén, España): diseño gráfico, edición de video y configuraciones para creadores y empresas. Este repositorio incluye **frontend estático**, **API Node.js (Express)** y **esquema de base de datos** (SQLite por defecto; variante MySQL incluida).

## Estructura

- `frontend/` — HTML, CSS y JS (landing, registro/login, área cliente, panel admin, panel trabajador, portfolio).
- `backend/` — Servidor Express, autenticación JWT, subida de archivos, rutas REST.
- `database/` — `schema.sql` (SQLite), `schema.mysql.sql` (MySQL 8+), archivo `alphavs.db` generado al inicializar.

## Requisitos

- [Node.js](https://nodejs.org/) 18 o superior.
- Windows / macOS / Linux.

## Instalación

1. Clona o copia el proyecto y abre una terminal en la carpeta `backend`:

   ```bash
   cd backend
   npm install
   ```

2. Crea el archivo de entorno (puedes copiar el ejemplo):

   ```bash
   copy .env.example .env
   ```

   Edita `.env` y define al menos **`JWT_SECRET`** (cadena larga y aleatoria en producción).

3. Inicializa la base de datos (crea `database/alphavs.db`, tablas, servicios con **precios fijos en €**, cupón de ejemplo `WELCOME10` y usuario administrador):

   ```bash
   npm run init-db
   ```

4. Arranca el servidor (sirve la API en `/api/*` y los archivos de `frontend/`):

   ```bash
   npm start
   ```

5. Abre en el navegador: **http://localhost:3000**

### Credenciales iniciales (solo desarrollo)

- **Admin:** `admin@alphavisualstudio.local` / `Admin123!`  
  Cámbialas en cuanto despliegues en producción.

## Funcionalidades implementadas

- Registro/login con **roles**: cliente, trabajador, administrador (JWT, contraseñas con bcrypt).
- **Catálogo de servicios** con precios fijos y tarifas por hora (según tu lista en €).
- **Carrito y checkout** con **cupones** (porcentaje o importe fijo).
- **Pedidos** con número de factura tipo `AVS-2026-00001`, estados y notificaciones básicas al cliente.
- **Presupuestos** (formulario + archivos adjuntos guardados en disco y metadatos en BD).
- **Tickets** de soporte.
- **Horario público** editable desde admin (JSON + etiquetas ES/EN).
- **Portfolio** (subida de imagen/video desde admin, listado público).
- **Panel admin:** estadísticas resumidas, usuarios/trabajadores, cupones, pedidos, asignación de tareas, presupuestos entrantes, tickets, horario, portfolio.
- **Panel trabajador:** solo tareas **asignadas** por el admin; cambio de estado (pendiente / en proceso / terminado); listado de clientes derivado de esas tareas.
- **Multi-idioma** en la home (ES/EN) y **tema claro/oscuro** (preferencia en `localStorage`).

## Producción y seguridad

- Cambia `JWT_SECRET`, contraseñas de admin y rutas de subida.
- Coloca HTTPS delante (proxy inverso) y limita CORS si hace falta.
- Para **MySQL**, importa `database/schema.mysql.sql`, adapta la capa de acceso a datos (este proyecto usa **better-sqlite3**; en MySQL suele usarse `mysql2` + mismas consultas parametrizadas).
- **Pagos (Stripe/PayPal)** y **suscripciones**: preparados a nivel de modelo de pedidos; falta integrar pasarela y webhooks.

## Nota sobre `index.html` en la raíz del proyecto

Si conservas un `index.html` antiguo en la raíz, ábrelo solo como referencia. La aplicación de plataforma unificada se sirve desde **`frontend/`** al ejecutar el backend.
