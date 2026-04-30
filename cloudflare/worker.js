const APP_NAME = "Sistema de calificaciones";
const SESSION_COOKIE = "calificaciones_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;
const ROLES = {
  ADMIN: "Administrador",
  TEACHER: "Docente",
  STUDENT: "Estudiante",
};

export default {
  async fetch(request, env) {
    try {
      await ensureSchema(env.DB);
      const url = new URL(request.url);
      const path = normalizePath(url.pathname);
      const user = await currentUser(request, env.DB);

      if (path === "/") return redirect(user ? "/calificaciones/" : "/login/");
      if (path === "/registro/") return handleRegister(request, env);
      if (path === "/login/") return handleLogin(request, env);
      if (path === "/logout/") return handleLogout(request, env);
      if (path === "/password-reset/") return passwordResetPage();
      if (path === "/password-reset/done/") return passwordResetDonePage();
      if (path === "/reset/done/") return passwordResetCompletePage();
      if (path === "/admin/") return adminInfoPage(user);

      if (!user) return redirect(`/login/?next=${encodeURIComponent(path)}`);

      if (path === "/calificaciones/") return listGrades(request, env, user);
      if (path === "/calificaciones/crear/") return createGrade(request, env, user);
      if (path.startsWith("/calificaciones/editar/")) return editGrade(request, env, user, idFromPath(path));
      if (path.startsWith("/calificaciones/eliminar/")) return deleteGrade(request, env, user, idFromPath(path));
      if (path === "/promedio-general/") return averagePage(env, user);

      return htmlPage("No encontrado", `<section class="panel"><h1>Pagina no encontrada</h1><p>La ruta solicitada no existe.</p></section>`, user, 404);
    } catch (error) {
      return htmlPage("Error", `<section class="panel"><h1>Error interno</h1><p>${escapeHtml(error.message)}</p></section>`, null, 500);
    }
  },
};

async function ensureSchema(db) {
  await db.batch([
    db.prepare("CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL UNIQUE, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'Estudiante', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)"),
    db.prepare("CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id INTEGER NOT NULL, expires_at INTEGER NOT NULL, FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE)"),
    db.prepare("CREATE TABLE IF NOT EXISTS calificaciones (id INTEGER PRIMARY KEY AUTOINCREMENT, nombre_estudiante TEXT NOT NULL, identificacion TEXT NOT NULL, asignatura TEXT NOT NULL, nota1 REAL NOT NULL, nota2 REAL NOT NULL, nota3 REAL NOT NULL, promedio REAL NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at)"),
  ]);
}

async function handleRegister(request, env) {
  const user = await currentUser(request, env.DB);
  if (request.method === "GET") {
    return htmlPage("Registro", authForm("registro", "/registro/", "Crear cuenta"), user);
  }

  const data = await request.formData();
  const username = clean(data.get("username"));
  const email = clean(data.get("email")).toLowerCase();
  const password1 = String(data.get("password1") || "");
  const password2 = String(data.get("password2") || "");
  const errors = [];

  if (username.length < 3 || username.length > 30) errors.push("El nombre de usuario debe tener entre 3 y 30 caracteres.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push("Ingresa un correo electronico valido.");
  if (password1.length < 8) errors.push("La contrasena debe tener al menos 8 caracteres.");
  if (password1 !== password2) errors.push("Las contrasenas no coinciden.");

  const existing = await env.DB.prepare("SELECT id FROM users WHERE lower(username) = lower(?) OR lower(email) = lower(?)").bind(username, email).first();
  if (existing) errors.push("Ya existe un usuario con ese nombre o correo.");

  if (errors.length) return htmlPage("Registro", authForm("registro", "/registro/", "Crear cuenta", errors, { username, email }), user, 400);

  await env.DB.prepare("INSERT INTO users (username, email, password_hash, role) VALUES (?, ?, ?, ?)")
    .bind(username, email, await hashPassword(password1), ROLES.STUDENT)
    .run();
  return redirect("/login/?message=Usuario registrado correctamente. Ahora puedes iniciar sesion.");
}

async function handleLogin(request, env) {
  const url = new URL(request.url);
  if (request.method === "GET") {
    const message = url.searchParams.get("message");
    return htmlPage("Iniciar sesion", authForm("login", "/login/", "Iniciar sesion", [], {}, message), null);
  }

  const data = await request.formData();
  const username = clean(data.get("username"));
  const password = String(data.get("password") || "");
  const user = await env.DB.prepare("SELECT * FROM users WHERE lower(username) = lower(?)").bind(username).first();

  if (!user || user.password_hash !== await hashPassword(password)) {
    return htmlPage("Iniciar sesion", authForm("login", "/login/", "Iniciar sesion", ["Ingresa un nombre de usuario y contrasena correctos."], { username }), null, 400);
  }

  const token = crypto.randomUUID();
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  await env.DB.prepare("INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)").bind(token, user.id, expiresAt).run();
  return redirect("/calificaciones/", cookieHeader(token, expiresAt));
}

async function handleLogout(request, env) {
  const token = getCookie(request, SESSION_COOKIE);
  if (token) await env.DB.prepare("DELETE FROM sessions WHERE token = ?").bind(token).run();
  return redirect("/login/", `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`);
}

async function listGrades(request, env, user) {
  requireRole(user, [ROLES.ADMIN, ROLES.TEACHER, ROLES.STUDENT]);
  const rows = await env.DB.prepare("SELECT * FROM calificaciones ORDER BY id").all();
  const avg = await env.DB.prepare("SELECT AVG(promedio) AS value FROM calificaciones").first();
  const body = `
    <section class="panel">
      <div class="header-row"><h1>Calificaciones</h1>${canCreate(user) ? '<a class="button" href="/calificaciones/crear/">Crear calificacion</a>' : ""}</div>
      ${gradeTable(rows.results || [], user)}
      <div class="summary"><strong>Promedio general:</strong> ${avg?.value == null ? "Sin registros" : Number(avg.value).toFixed(2)}</div>
    </section>`;
  return htmlPage("Calificaciones", body, user);
}

async function createGrade(request, env, user) {
  requireRole(user, [ROLES.ADMIN, ROLES.TEACHER]);
  if (request.method === "GET") return htmlPage("Crear calificacion", gradeForm("/calificaciones/crear/"), user);
  const result = parseGradeForm(await request.formData());
  if (result.errors.length) return htmlPage("Crear calificacion", gradeForm("/calificaciones/crear/", result.values, result.errors), user, 400);
  await insertGrade(env.DB, result.values);
  return redirect("/calificaciones/");
}

async function editGrade(request, env, user, id) {
  requireRole(user, [ROLES.ADMIN, ROLES.TEACHER]);
  const grade = await env.DB.prepare("SELECT * FROM calificaciones WHERE id = ?").bind(id).first();
  if (!grade) return htmlPage("No encontrado", `<section class="panel"><h1>Registro no encontrado</h1></section>`, user, 404);
  if (request.method === "GET") return htmlPage("Editar calificacion", gradeForm(`/calificaciones/editar/${id}/`, grade), user);
  const result = parseGradeForm(await request.formData());
  if (result.errors.length) return htmlPage("Editar calificacion", gradeForm(`/calificaciones/editar/${id}/`, result.values, result.errors), user, 400);
  await updateGrade(env.DB, id, result.values);
  return redirect("/calificaciones/");
}

async function deleteGrade(request, env, user, id) {
  requireRole(user, [ROLES.ADMIN]);
  const grade = await env.DB.prepare("SELECT * FROM calificaciones WHERE id = ?").bind(id).first();
  if (!grade) return htmlPage("No encontrado", `<section class="panel"><h1>Registro no encontrado</h1></section>`, user, 404);
  if (request.method === "POST") {
    await env.DB.prepare("DELETE FROM calificaciones WHERE id = ?").bind(id).run();
    return redirect("/calificaciones/");
  }
  return htmlPage("Eliminar calificacion", `
    <section class="panel">
      <h1>Eliminar calificacion</h1>
      <p>Confirma la eliminacion de la calificacion de <strong>${escapeHtml(grade.nombre_estudiante)}</strong>.</p>
      <form method="post"><button class="button danger" type="submit">Eliminar</button> <a class="button secondary" href="/calificaciones/">Cancelar</a></form>
    </section>`, user);
}

async function averagePage(env, user) {
  requireRole(user, [ROLES.ADMIN, ROLES.TEACHER, ROLES.STUDENT]);
  const avg = await env.DB.prepare("SELECT AVG(promedio) AS value FROM calificaciones").first();
  return htmlPage("Promedio general", `
    <section class="panel">
      <h1>Promedio general</h1>
      <div class="summary">${avg?.value == null ? "No hay calificaciones registradas." : `El promedio general es <strong>${Number(avg.value).toFixed(2)}</strong>.`}</div>
      <a class="button secondary" href="/calificaciones/">Volver</a>
    </section>`, user);
}

function passwordResetPage() {
  return htmlPage("Recuperar contrasena", `
    <section class="panel">
      <h1>Recuperar contrasena</h1>
      <p>El despliegue en Cloudflare Workers no tiene SMTP configurado. Solicita el cambio al administrador del sistema.</p>
      <a class="button secondary" href="/login/">Volver</a>
    </section>`, null);
}

function passwordResetDonePage() {
  return htmlPage("Correo enviado", `<section class="panel"><h1>Solicitud recibida</h1><p>Revisa las instrucciones del administrador.</p></section>`, null);
}

function passwordResetCompletePage() {
  return htmlPage("Contrasena actualizada", `<section class="panel"><h1>Contrasena actualizada</h1><a class="button" href="/login/">Iniciar sesion</a></section>`, null);
}

function adminInfoPage(user) {
  if (!user) return redirect("/login/?next=/admin/");
  return htmlPage("Administracion", `
    <section class="panel">
      <h1>Administracion</h1>
      <p>En Cloudflare la administracion se realiza desde D1 o mediante los flujos de la aplicacion. Los roles validos son Administrador, Docente y Estudiante.</p>
      <p>El primer usuario creado queda como Estudiante por compatibilidad con el proyecto Django.</p>
    </section>`, user);
}

function gradeTable(rows, user) {
  if (!rows.length) return "<p>No hay calificaciones registradas.</p>";
  const actions = canEdit(user) || canDelete(user);
  return `
    <div class="table-wrap"><table>
      <thead><tr><th>ID</th><th>Estudiante</th><th>Identificacion</th><th>Asignatura</th><th>Nota 1</th><th>Nota 2</th><th>Nota 3</th><th>Promedio</th>${actions ? "<th>Acciones</th>" : ""}</tr></thead>
      <tbody>${rows.map((g) => `
        <tr>
          <td>${g.id}</td><td>${escapeHtml(g.nombre_estudiante)}</td><td>${escapeHtml(g.identificacion)}</td><td>${escapeHtml(g.asignatura)}</td>
          <td>${fmt(g.nota1)}</td><td>${fmt(g.nota2)}</td><td>${fmt(g.nota3)}</td><td>${fmt(g.promedio)}</td>
          ${actions ? `<td class="actions">${canEdit(user) ? `<a href="/calificaciones/editar/${g.id}/">Editar</a>` : ""}${canDelete(user) ? `<a href="/calificaciones/eliminar/${g.id}/">Eliminar</a>` : ""}</td>` : ""}
        </tr>`).join("")}</tbody>
    </table></div>`;
}

function gradeForm(action, values = {}, errors = []) {
  return `
    <section class="panel">
      <h1>${action.includes("editar") ? "Editar" : "Crear"} calificacion</h1>
      ${errorList(errors)}
      <form method="post" action="${action}">
        ${input("nombre_estudiante", "Nombre del estudiante", values.nombre_estudiante)}
        ${input("identificacion", "Identificacion", values.identificacion)}
        ${input("asignatura", "Asignatura", values.asignatura)}
        ${input("nota1", "Nota 1", values.nota1, "number", "0", "5", "0.01")}
        ${input("nota2", "Nota 2", values.nota2, "number", "0", "5", "0.01")}
        ${input("nota3", "Nota 3", values.nota3, "number", "0", "5", "0.01")}
        <button class="button" type="submit">Guardar</button>
        <a class="button secondary" href="/calificaciones/">Cancelar</a>
      </form>
    </section>`;
}

function authForm(kind, action, button, errors = [], values = {}, message = "") {
  const isRegister = kind === "registro";
  return `
    <section class="panel auth-panel">
      <h1>${button}</h1>
      ${message ? `<ul class="messages"><li>${escapeHtml(message)}</li></ul>` : ""}
      ${errorList(errors)}
      <form method="post" action="${action}">
        ${input("username", "Nombre de usuario", values.username)}
        ${isRegister ? input("email", "Correo electronico", values.email, "email") : ""}
        ${input(isRegister ? "password1" : "password", isRegister ? "Contrasena" : "Contrasena", "", "password")}
        ${isRegister ? input("password2", "Confirmar contrasena", "", "password") : ""}
        <button class="button" type="submit">${button}</button>
      </form>
      <p class="help-text">${isRegister ? 'Ya tienes cuenta? <a href="/login/">Inicia sesion</a>.' : 'No tienes cuenta? <a href="/registro/">Registrate</a>.'}</p>
      ${!isRegister ? '<p class="help-text"><a href="/password-reset/">Olvide mi contrasena</a></p>' : ""}
    </section>`;
}

function parseGradeForm(data) {
  const values = {
    nombre_estudiante: clean(data.get("nombre_estudiante")),
    identificacion: clean(data.get("identificacion")),
    asignatura: clean(data.get("asignatura")),
    nota1: Number(data.get("nota1")),
    nota2: Number(data.get("nota2")),
    nota3: Number(data.get("nota3")),
  };
  const errors = [];
  if (values.nombre_estudiante.length < 3 || /^\d+$/.test(values.nombre_estudiante)) errors.push("El nombre del estudiante debe tener al menos 3 caracteres y no puede ser solo numerico.");
  if (!/^\d{5,15}$/.test(values.identificacion)) errors.push("La identificacion debe contener entre 5 y 15 digitos numericos.");
  if (values.asignatura.length < 3 || /^\d+$/.test(values.asignatura)) errors.push("La asignatura debe tener al menos 3 caracteres y no puede ser solo numerica.");
  for (const field of ["nota1", "nota2", "nota3"]) {
    if (Number.isNaN(values[field]) || values[field] < 0 || values[field] > 5) errors.push(`${field} debe estar entre 0 y 5.`);
  }
  values.promedio = Math.round(((values.nota1 + values.nota2 + values.nota3) / 3) * 100) / 100;
  return { values, errors };
}

async function insertGrade(db, v) {
  await db.prepare("INSERT INTO calificaciones (nombre_estudiante, identificacion, asignatura, nota1, nota2, nota3, promedio) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(v.nombre_estudiante, v.identificacion, v.asignatura, v.nota1, v.nota2, v.nota3, v.promedio)
    .run();
}

async function updateGrade(db, id, v) {
  await db.prepare("UPDATE calificaciones SET nombre_estudiante = ?, identificacion = ?, asignatura = ?, nota1 = ?, nota2 = ?, nota3 = ?, promedio = ? WHERE id = ?")
    .bind(v.nombre_estudiante, v.identificacion, v.asignatura, v.nota1, v.nota2, v.nota3, v.promedio, id)
    .run();
}

async function currentUser(request, db) {
  const token = getCookie(request, SESSION_COOKIE);
  if (!token) return null;
  const now = Math.floor(Date.now() / 1000);
  return db.prepare("SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ? AND s.expires_at > ?").bind(token, now).first();
}

function requireRole(user, roles) {
  if (!user || !roles.includes(user.role)) {
    const err = new Error("No tienes permisos para acceder a esta pagina.");
    err.status = 403;
    throw err;
  }
}

async function hashPassword(password) {
  const bytes = new TextEncoder().encode(password);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function htmlPage(title, content, user = null, status = 200) {
  return new Response(`<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)} - ${APP_NAME}</title>
  <style>
    :root { color: #1f2937; background: #f3f4f6; font-family: Arial, sans-serif; }
    body { margin: 0; }
    nav { align-items: center; background: #111827; color: #fff; display: flex; flex-wrap: wrap; gap: 12px; justify-content: space-between; padding: 14px 24px; }
    nav a, nav button { background: transparent; border: 0; color: #fff; cursor: pointer; font: inherit; padding: 0; text-decoration: none; }
    nav a:hover, nav button:hover, a:hover { text-decoration: underline; }
    .nav-links { align-items: center; display: flex; flex-wrap: wrap; gap: 12px; }
    main { margin: 32px auto; max-width: 1000px; padding: 0 20px; }
    .panel { background: #fff; border: 1px solid #e5e7eb; border-radius: 8px; padding: 24px; }
    .auth-panel { max-width: 460px; margin: 0 auto; }
    .header-row { align-items: center; display: flex; justify-content: space-between; gap: 12px; }
    .table-wrap { overflow-x: auto; }
    table { border-collapse: collapse; width: 100%; }
    th, td { border-bottom: 1px solid #e5e7eb; padding: 10px; text-align: left; white-space: nowrap; }
    th { background: #f9fafb; }
    label { display: block; font-weight: 700; margin: 12px 0 4px; }
    input { border: 1px solid #d1d5db; border-radius: 6px; box-sizing: border-box; padding: 10px; width: 100%; }
    .button, button.button { background: #2563eb; border: 0; border-radius: 6px; color: #fff; cursor: pointer; display: inline-block; font-weight: 700; margin-top: 16px; padding: 10px 14px; text-decoration: none; }
    .button.secondary { background: #4b5563; }
    .button.danger { background: #dc2626; }
    .actions { display: flex; flex-wrap: wrap; gap: 8px; }
    .messages, .field-errors { list-style: none; margin: 0 0 16px; padding: 0; }
    .messages li { background: #ecfdf5; border: 1px solid #a7f3d0; border-radius: 6px; margin-bottom: 8px; padding: 10px; }
    .field-errors li { background: #fef2f2; border: 1px solid #fecaca; border-radius: 6px; color: #991b1b; margin-bottom: 8px; padding: 10px; }
    .summary { background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 6px; margin-top: 18px; padding: 14px; }
    .help-text { color: #4b5563; font-size: 0.95rem; margin: 14px 0 0; }
    @media (max-width: 640px) { nav { padding: 14px 16px; } main { margin: 20px auto; padding: 0 12px; } .panel { padding: 18px; } .header-row { align-items: flex-start; flex-direction: column; } }
  </style>
</head>
<body>
  <nav>
    <strong>${APP_NAME}</strong>
    <div class="nav-links">${navLinks(user)}</div>
  </nav>
  <main>${content}</main>
</body>
</html>`, { status, headers: { "content-type": "text/html; charset=utf-8" } });
}

function navLinks(user) {
  if (!user) return '<a href="/login/">Iniciar sesion</a><a href="/registro/">Registro</a>';
  return `
    <span>${escapeHtml(user.username)} (${escapeHtml(user.role)})</span>
    <a href="/calificaciones/">Calificaciones</a>
    <a href="/promedio-general/">Promedio general</a>
    ${canCreate(user) ? '<a href="/calificaciones/crear/">Crear calificacion</a>' : ""}
    <form method="post" action="/logout/"><button type="submit">Cerrar sesion</button></form>`;
}

function input(name, label, value = "", type = "text", min = "", max = "", step = "") {
  const attrs = [
    `type="${type}"`,
    `name="${name}"`,
    `id="${name}"`,
    `value="${escapeHtml(value ?? "")}"`,
    min !== "" ? `min="${min}"` : "",
    max !== "" ? `max="${max}"` : "",
    step !== "" ? `step="${step}"` : "",
    "required",
  ].filter(Boolean).join(" ");
  return `<label for="${name}">${label}</label><input ${attrs}>`;
}

function errorList(errors) {
  return errors.length ? `<ul class="field-errors">${errors.map((e) => `<li>${escapeHtml(e)}</li>`).join("")}</ul>` : "";
}

function canCreate(user) {
  return user && [ROLES.ADMIN, ROLES.TEACHER].includes(user.role);
}

function canEdit(user) {
  return canCreate(user);
}

function canDelete(user) {
  return user?.role === ROLES.ADMIN;
}

function redirect(location, cookie = null) {
  const headers = { location };
  if (cookie) headers["set-cookie"] = cookie;
  return new Response(null, { status: 302, headers });
}

function cookieHeader(token, expiresAt) {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${expiresAt - Math.floor(Date.now() / 1000)}`;
}

function getCookie(request, name) {
  const cookie = request.headers.get("cookie") || "";
  return cookie.split(";").map((v) => v.trim()).find((v) => v.startsWith(`${name}=`))?.slice(name.length + 1) || "";
}

function normalizePath(path) {
  return path.endsWith("/") ? path : `${path}/`;
}

function idFromPath(path) {
  return Number(path.split("/").filter(Boolean).at(-1));
}

function clean(value) {
  return String(value || "").trim();
}

function fmt(value) {
  return Number(value).toFixed(2);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
