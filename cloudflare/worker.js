const APP_NAME = "Sistema de calificaciones";
const SESSION_COOKIE = "calificaciones_session";
const D1_BOOKMARK_COOKIE = "calificaciones_d1_bookmark";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;
const ROLES = {
  ADMIN: "Administrador",
  TEACHER: "Docente",
  STUDENT: "Estudiante",
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = normalizePath(url.pathname);
    const dbContext = createDbContext(request, env.DB);
    let user = null;

    try {
      await ensureSchema(dbContext.db);
      user = await currentUser(request, dbContext.db);

      let response;
      if (path === "/") response = homePage(user);
      else if (path === "/registro/") response = await handleRegister(request, dbContext.db, user);
      else if (path === "/login/") response = await handleLogin(request, dbContext.db);
      else if (path === "/logout/") response = await handleLogout(request, dbContext.db);
      else if (path === "/password-reset/") response = passwordResetPage();
      else if (path === "/password-reset/done/") response = passwordResetDonePage();
      else if (path === "/reset/done/") response = passwordResetCompletePage();
      else if (path === "/admin/") response = await adminDashboard(request, dbContext.db, user);
      else if (path === "/admin/login/") response = await adminLogin(request, dbContext.db, user);
      else if (path === "/admin/logout/") response = await adminLogout(request, dbContext.db);
      else if (path === "/admin/users/" || path === "/admin/auth/user/") response = await adminUsersPage(request, dbContext.db, user);
      else if (path === "/admin/auth/" || path === "/admin/auth/group/") response = redirect("/admin/users/");
      else if (path === "/admin/users/role/") response = await updateUserRole(request, dbContext.db, user);
      else if (isAdminGradeListPath(path)) response = await adminGradeList(request, dbContext.db, user);
      else if (isAdminGradeCreatePath(path)) response = await adminGradeForm(request, dbContext.db, user);
      else if (isAdminGradeEditPath(path)) response = await adminGradeForm(request, dbContext.db, user, adminGradeId(path));
      else if (isAdminGradeDeletePath(path)) response = await adminGradeDelete(request, dbContext.db, user, adminGradeId(path));
      else response = await appRoute(request, dbContext.db, user, path);

      return finalizeResponse(response, dbContext);
    } catch (error) {
      console.error(JSON.stringify({
        message: "worker request failed",
        path,
        error: error?.message || String(error),
      }));

      const status = error?.status || 500;
      const title = status === 403 ? "Acceso denegado" : "Error";
      const message = status === 403 ? error.message : "No se pudo completar la solicitud.";
      return finalizeResponse(
        htmlPage(title, `<section class="panel"><h1>${title}</h1><p>${escapeHtml(message)}</p><a class="button secondary" href="/">Volver al inicio</a></section>`, user, status),
        dbContext,
      );
    }
  },
};

async function appRoute(request, db, user, path) {
  if (!user) return redirect(`/login/?next=${encodeURIComponent(path)}`);

  if (path === "/calificaciones/") return listGrades(db, user);
  if (path === "/calificaciones/crear/") return createGrade(request, db, user);
  if (path.startsWith("/calificaciones/editar/")) return editGrade(request, db, user, idFromPath(path));
  if (path.startsWith("/calificaciones/eliminar/")) return deleteGrade(request, db, user, idFromPath(path));
  if (path === "/promedio-general/") return averagePage(db, user);

  return htmlPage("No encontrado", `<section class="panel"><h1>Página no encontrada</h1><p>La ruta solicitada no existe.</p></section>`, user, 404);
}

function createDbContext(request, db) {
  if (typeof db?.withSession !== "function") return { db, session: null };

  const bookmark = decodeCookieValue(getCookie(request, D1_BOOKMARK_COOKIE)) || "first-primary";
  try {
    const session = db.withSession(bookmark);
    return { db: session, session };
  } catch {
    const session = db.withSession("first-primary");
    return { db: session, session };
  }
}

async function ensureSchema(db) {
  await db.batch([
    db.prepare("CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL UNIQUE, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'Estudiante', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)"),
    db.prepare("CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id INTEGER NOT NULL, expires_at INTEGER NOT NULL, FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE)"),
    db.prepare("CREATE TABLE IF NOT EXISTS calificaciones (id INTEGER PRIMARY KEY AUTOINCREMENT, nombre_estudiante TEXT NOT NULL, identificacion TEXT NOT NULL, asignatura TEXT NOT NULL, nota1 REAL NOT NULL, nota2 REAL NOT NULL, nota3 REAL NOT NULL, promedio REAL NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at)"),
  ]);
  await ensureAdminUser(db);
}

async function ensureAdminUser(db) {
  const admin = await db.prepare("SELECT id FROM users WHERE role = ? LIMIT 1").bind(ROLES.ADMIN).first();
  if (admin) return;

  const passwordHash = await hashPassword("admin");
  const existing = await db.prepare("SELECT id FROM users WHERE lower(username) = lower(?)").bind("admin").first();
  if (existing) {
    await db.prepare("UPDATE users SET password_hash = ?, role = ? WHERE id = ?").bind(passwordHash, ROLES.ADMIN, existing.id).run();
    return;
  }

  await db.prepare("INSERT INTO users (username, email, password_hash, role) VALUES (?, ?, ?, ?)")
    .bind("admin", "admin@workers.local", passwordHash, ROLES.ADMIN)
    .run();
}

async function handleRegister(request, db, user) {
  if (request.method === "GET") {
    return htmlPage("Registro", authForm("registro", "/registro/", "Crear cuenta"), user);
  }

  assertSameOriginPost(request);
  const data = await request.formData();
  const username = clean(data.get("username"));
  const email = clean(data.get("email")).toLowerCase();
  const password1 = String(data.get("password1") || "");
  const password2 = String(data.get("password2") || "");
  const errors = [];

  if (username.length < 3 || username.length > 30) errors.push("El nombre de usuario debe tener entre 3 y 30 caracteres.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push("Ingresa un correo electrónico válido.");
  if (password1.length < 8) errors.push("La contraseña debe tener al menos 8 caracteres.");
  if (password1 !== password2) errors.push("Las contraseñas no coinciden.");

  const existing = await db.prepare("SELECT id FROM users WHERE lower(username) = lower(?) OR lower(email) = lower(?)").bind(username, email).first();
  if (existing) errors.push("Ya existe un usuario con ese nombre o correo.");

  if (errors.length) return htmlPage("Registro", authForm("registro", "/registro/", "Crear cuenta", errors, { username, email }), user, 400);

  await db.prepare("INSERT INTO users (username, email, password_hash, role) VALUES (?, ?, ?, ?)")
    .bind(username, email, await hashPassword(password1), ROLES.STUDENT)
    .run();
  return redirect("/login/?message=Usuario registrado correctamente. Ahora puedes iniciar sesión.");
}

async function handleLogin(request, db) {
  const url = new URL(request.url);
  const next = safeNextPath(url.searchParams.get("next"), "/calificaciones/");
  const action = next === "/calificaciones/" ? "/login/" : `/login/?next=${encodeURIComponent(next)}`;

  if (request.method === "GET") {
    const message = url.searchParams.get("message");
    return htmlPage("Iniciar sesión", authForm("login", action, "Entrar", [], {}, message), null);
  }

  assertSameOriginPost(request);
  const data = await request.formData();
  const username = clean(data.get("username"));
  const password = String(data.get("password") || "");
  const user = await db.prepare("SELECT * FROM users WHERE lower(username) = lower(?)").bind(username).first();

  if (!user || user.password_hash !== await hashPassword(password)) {
    return htmlPage("Iniciar sesión", authForm("login", action, "Entrar", ["Ingresa un nombre de usuario y contraseña correctos."], { username }), null, 400);
  }

  const token = crypto.randomUUID();
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  await db.prepare("INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)").bind(token, user.id, expiresAt).run();
  return redirect(next, cookieHeader(token, expiresAt));
}

async function handleLogout(request, db) {
  assertSameOriginPost(request);
  const token = getCookie(request, SESSION_COOKIE);
  if (token) await db.prepare("DELETE FROM sessions WHERE token = ?").bind(token).run();
  return redirect("/login/", expiredSessionCookie());
}

async function listGrades(db, user) {
  requireRole(user, [ROLES.ADMIN, ROLES.TEACHER, ROLES.STUDENT]);
  const rows = await db.prepare("SELECT * FROM calificaciones ORDER BY id").all();
  const avg = await db.prepare("SELECT AVG(promedio) AS value FROM calificaciones").first();
  const body = `
    <section class="panel table-panel">
      <div class="panel-header-inline">
        <div>
          <h1 class="panel-title">Calificaciones</h1>
          <p class="panel-copy">Consulta los registros disponibles del sistema.</p>
        </div>
        ${canCreate(user) ? '<a class="button" href="/calificaciones/crear/">Crear calificación</a>' : ""}
      </div>
      ${gradeTable(rows.results || [], user)}
      <div class="summary"><strong>Promedio general:</strong> ${avg?.value == null ? "Sin registros" : Number(avg.value).toFixed(2)}</div>
    </section>`;
  return htmlPage("Calificaciones", body, user);
}

async function createGrade(request, db, user) {
  requireRole(user, [ROLES.ADMIN, ROLES.TEACHER]);
  if (request.method === "GET") return htmlPage("Crear calificación", gradeForm("/calificaciones/crear/"), user);

  assertSameOriginPost(request);
  const result = parseGradeForm(await request.formData());
  if (result.errors.length) return htmlPage("Crear calificación", gradeForm("/calificaciones/crear/", result.values, result.errors), user, 400);
  await insertGrade(db, result.values);
  return redirect("/calificaciones/");
}

async function editGrade(request, db, user, id) {
  requireRole(user, [ROLES.ADMIN, ROLES.TEACHER]);
  const grade = await db.prepare("SELECT * FROM calificaciones WHERE id = ?").bind(id).first();
  if (!grade) return htmlPage("No encontrado", `<section class="panel"><h1>Registro no encontrado</h1></section>`, user, 404);
  if (request.method === "GET") return htmlPage("Editar calificación", gradeForm(`/calificaciones/editar/${id}/`, grade), user);

  assertSameOriginPost(request);
  const result = parseGradeForm(await request.formData());
  if (result.errors.length) return htmlPage("Editar calificación", gradeForm(`/calificaciones/editar/${id}/`, result.values, result.errors), user, 400);
  await updateGrade(db, id, result.values);
  return redirect("/calificaciones/");
}

async function deleteGrade(request, db, user, id) {
  requireRole(user, [ROLES.ADMIN]);
  const grade = await db.prepare("SELECT * FROM calificaciones WHERE id = ?").bind(id).first();
  if (!grade) return htmlPage("No encontrado", `<section class="panel"><h1>Registro no encontrado</h1></section>`, user, 404);
  if (request.method === "POST") {
    assertSameOriginPost(request);
    await db.prepare("DELETE FROM calificaciones WHERE id = ?").bind(id).run();
    return redirect("/calificaciones/");
  }
  return htmlPage("Eliminar calificación", `
    <section class="panel danger-panel">
      <h1 class="panel-title">Eliminar calificación</h1>
      <p>Confirma la eliminación de la calificación de <strong>${escapeHtml(grade.nombre_estudiante)}</strong>.</p>
      <form method="post" class="button-row">
        <button class="button danger" type="submit">Eliminar</button>
        <a class="button secondary" href="/calificaciones/">Cancelar</a>
      </form>
    </section>`, user);
}

async function averagePage(db, user) {
  requireRole(user, [ROLES.ADMIN, ROLES.TEACHER, ROLES.STUDENT]);
  const avg = await db.prepare("SELECT AVG(promedio) AS value FROM calificaciones").first();
  return htmlPage("Promedio general", `
    <section class="panel">
      <h1 class="panel-title">Promedio general</h1>
      <div class="summary">${avg?.value == null ? "No hay calificaciones registradas." : `El promedio general es <strong>${Number(avg.value).toFixed(2)}</strong>.`}</div>
      <a class="button secondary" href="/calificaciones/">Volver</a>
    </section>`, user);
}

function passwordResetPage() {
  return htmlPage("Recuperar contraseña", `
    <section class="panel">
      <h1 class="panel-title">Recuperar contraseña</h1>
      <p>La recuperación por correo no está configurada. Solicita el cambio al administrador del sistema.</p>
      <a class="button secondary" href="/login/">Volver</a>
    </section>`, null);
}

function passwordResetDonePage() {
  return htmlPage("Correo enviado", `<section class="panel"><h1>Solicitud recibida</h1><p>Revisa las instrucciones del administrador.</p></section>`, null);
}

function passwordResetCompletePage() {
  return htmlPage("Contraseña actualizada", `<section class="panel"><h1>Contraseña actualizada</h1><a class="button" href="/login/">Iniciar sesión</a></section>`, null);
}

async function adminDashboard(request, db, user) {
  if (!user) return redirect("/admin/login/?next=/admin/");
  requireRole(user, [ROLES.ADMIN]);

  const [userCount, gradeCount, avg, roleCounts, latestGrade] = await db.batch([
    db.prepare("SELECT COUNT(*) AS value FROM users"),
    db.prepare("SELECT COUNT(*) AS value FROM calificaciones"),
    db.prepare("SELECT AVG(promedio) AS value FROM calificaciones"),
    db.prepare("SELECT role, COUNT(*) AS value FROM users GROUP BY role ORDER BY role"),
    db.prepare("SELECT id, nombre_estudiante, asignatura, promedio, created_at FROM calificaciones ORDER BY id DESC LIMIT 1"),
  ]);
  const roles = new Map((roleCounts.results || []).map((row) => [row.role, row.value]));
  const latest = latestGrade.results?.[0];

  return adminPage("Administración", `
    <section class="page-stack">
      <section class="panel">
        <div class="panel-header-inline">
          <div>
            <span class="hero-kicker">Administración</span>
            <h1 class="panel-title">Panel administrativo</h1>
            <p class="panel-copy">Gestiona usuarios, roles y calificaciones desde un panel centralizado.</p>
          </div>
        </div>
      </section>

      <section class="admin-metrics" aria-label="Resumen">
        ${metricCard("Usuarios", userCount.results?.[0]?.value || 0, "Cuentas registradas")}
        ${metricCard("Calificaciones", gradeCount.results?.[0]?.value || 0, "Registros guardados")}
        ${metricCard("Promedio", avg.results?.[0]?.value == null ? "N/A" : Number(avg.results[0].value).toFixed(2), "Promedio general")}
      </section>

      <section class="admin-actions-grid">
        <article class="panel">
          <h2>Usuarios y roles</h2>
          <p class="panel-copy">Asigna permisos por rol de usuario.</p>
          <div class="button-row"><a class="button" href="/admin/users/">Gestionar usuarios</a></div>
        </article>
        <article class="panel">
          <h2>Calificaciones</h2>
          <p class="panel-copy">Crea, edita o elimina notas. El promedio se recalcula al guardar.</p>
          <div class="button-row"><a class="button" href="/admin/calificaciones/">Ver calificaciones</a><a class="button secondary" href="/admin/calificaciones/crear/">Crear calificación</a></div>
        </article>
      </section>

      <section class="panel">
        <div class="panel-header-inline">
          <div>
            <h2>Estado de datos</h2>
            <p class="panel-copy">Información actualizada después de cada acción administrativa.</p>
          </div>
        </div>
        <div class="status-grid">
          ${Object.values(ROLES).map((role) => `<div><strong>${role}</strong><span>${roles.get(role) || 0}</span></div>`).join("")}
          <div><strong>Última calificación</strong><span>${latest ? `${escapeHtml(latest.nombre_estudiante)} (${fmt(latest.promedio)})` : "Sin registros"}</span></div>
        </div>
      </section>
    </section>`, user);
}

async function adminLogin(request, db, user) {
  const url = new URL(request.url);
  const next = safeNextPath(url.searchParams.get("next"), "/admin/");
  if (user?.role === ROLES.ADMIN && request.method === "GET") return redirect(next);

  const action = `/admin/login/?next=${encodeURIComponent(next)}`;
  const errors = [];
  if (request.method === "POST") {
    assertSameOriginPost(request);
    const data = await request.formData();
    const username = clean(data.get("username"));
    const password = String(data.get("password") || "");
    const found = await db.prepare("SELECT * FROM users WHERE lower(username) = lower(?)").bind(username).first();

    if (found && found.role === ROLES.ADMIN && found.password_hash === await hashPassword(password)) {
      const token = crypto.randomUUID();
      const expiresAt = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
      await db.prepare("INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)").bind(token, found.id, expiresAt).run();
      return redirect(next, cookieHeader(token, expiresAt));
    }

    errors.push("Ingresa credenciales válidas de una cuenta administradora.");
  }

  return adminPage("Admin", `
    <section class="auth-layout">
      <article class="panel auth-card">
        <div class="panel-header">
          <span class="hero-kicker">Admin</span>
          <h1 class="panel-title">Acceso administrativo</h1>
          <p class="panel-copy">Entra con una cuenta Administrador para gestionar usuarios y calificaciones.</p>
        </div>
        ${errorList(errors)}
        <form method="post" action="${action}" class="form-stack">
          ${input("username", "Nombre de usuario")}
          ${input("password", "Contraseña", "", "password")}
          <button class="button" type="submit">Entrar</button>
        </form>
      </article>
    </section>`, null);
}

async function adminLogout(request, db) {
  assertSameOriginPost(request);
  const token = getCookie(request, SESSION_COOKIE);
  if (token) await db.prepare("DELETE FROM sessions WHERE token = ?").bind(token).run();
  return redirect("/admin/login/", expiredSessionCookie());
}

async function adminUsersPage(request, db, user) {
  if (!user) return redirect("/admin/login/?next=/admin/users/");
  requireRole(user, [ROLES.ADMIN]);
  const rows = await db.prepare("SELECT id, username, email, role, created_at FROM users ORDER BY id").all();

  return adminPage("Usuarios", `
    <section class="panel table-panel">
      <div class="panel-header-inline">
        <div>
          <span class="hero-kicker">Admin</span>
          <h1 class="panel-title">Usuarios y roles</h1>
          <p class="panel-copy">Los cambios se reflejan al actualizar el rol de cada usuario.</p>
        </div>
        <a class="button secondary" href="/admin/">Volver al panel</a>
      </div>
      ${adminUsersTable(rows.results || [], user)}
    </section>`, user);
}

async function updateUserRole(request, db, user) {
  if (!user) return redirect("/admin/login/?next=/admin/users/");
  requireRole(user, [ROLES.ADMIN]);
  if (request.method !== "POST") return redirect("/admin/users/");

  assertSameOriginPost(request);
  const data = await request.formData();
  const userId = Number(data.get("user_id"));
  const role = clean(data.get("role"));
  if (!userId || !Object.values(ROLES).includes(role)) {
    return adminPage("Rol inválido", `<section class="panel"><h1>Rol inválido</h1><p>No se pudo actualizar el usuario solicitado.</p><a class="button secondary" href="/admin/users/">Volver</a></section>`, user, 400);
  }

  const target = await db.prepare("SELECT id, role FROM users WHERE id = ?").bind(userId).first();
  if (!target) return adminPage("Usuario no encontrado", `<section class="panel"><h1>Usuario no encontrado</h1><a class="button secondary" href="/admin/users/">Volver</a></section>`, user, 404);

  if (target.role === ROLES.ADMIN && role !== ROLES.ADMIN) {
    const admins = await db.prepare("SELECT COUNT(*) AS value FROM users WHERE role = ?").bind(ROLES.ADMIN).first();
    if (Number(admins?.value || 0) <= 1) {
      return adminPage("Acción bloqueada", `<section class="panel"><h1>No se puede quitar el último administrador</h1><p>Debe existir al menos una cuenta administradora.</p><a class="button secondary" href="/admin/users/">Volver</a></section>`, user, 400);
    }
  }

  await db.prepare("UPDATE users SET role = ? WHERE id = ?").bind(role, userId).run();
  return redirect("/admin/users/");
}

async function adminGradeList(request, db, user) {
  if (!user) return redirect("/admin/login/?next=/admin/calificaciones/");
  requireRole(user, [ROLES.ADMIN]);
  const rows = await db.prepare("SELECT * FROM calificaciones ORDER BY id DESC").all();
  const avg = await db.prepare("SELECT AVG(promedio) AS value FROM calificaciones").first();

  return adminPage("Admin calificaciones", `
    <section class="panel table-panel">
      <div class="panel-header-inline">
        <div>
          <span class="hero-kicker">Admin</span>
          <h1 class="panel-title">Calificaciones</h1>
          <p class="panel-copy">Promedio general: <strong>${avg?.value == null ? "Sin registros" : Number(avg.value).toFixed(2)}</strong></p>
        </div>
        <div class="button-row">
          <a class="button secondary" href="/admin/">Panel</a>
          <a class="button" href="/admin/calificaciones/crear/">Crear calificación</a>
        </div>
      </div>
      ${adminGradeTable(rows.results || [])}
    </section>`, user);
}

async function adminGradeForm(request, db, user, id = null) {
  if (!user) return redirect(`/admin/login/?next=${encodeURIComponent(new URL(request.url).pathname)}`);
  requireRole(user, [ROLES.ADMIN]);
  const isChange = id != null;
  const grade = isChange ? await db.prepare("SELECT * FROM calificaciones WHERE id = ?").bind(id).first() : null;
  if (isChange && !grade) return adminPage("No encontrado", '<section class="panel"><h1>Calificación no encontrada</h1></section>', user, 404);

  let values = grade || {};
  const errors = [];
  if (request.method === "POST") {
    assertSameOriginPost(request);
    const parsed = parseGradeForm(await request.formData());
    values = parsed.values;
    errors.push(...parsed.errors);
    if (!errors.length) {
      if (isChange) await updateGrade(db, id, values);
      else await insertGrade(db, values);
      return redirect("/admin/calificaciones/");
    }
  }

  return adminPage(isChange ? "Editar calificación" : "Crear calificación", adminGradeFormHtml(isChange, values, errors, id), user);
}

async function adminGradeDelete(request, db, user, id) {
  if (!user) return redirect(`/admin/login/?next=${encodeURIComponent(new URL(request.url).pathname)}`);
  requireRole(user, [ROLES.ADMIN]);
  const grade = await db.prepare("SELECT * FROM calificaciones WHERE id = ?").bind(id).first();
  if (!grade) return adminPage("No encontrado", '<section class="panel"><h1>Calificación no encontrada</h1></section>', user, 404);

  if (request.method === "POST") {
    assertSameOriginPost(request);
    await db.prepare("DELETE FROM calificaciones WHERE id = ?").bind(id).run();
    return redirect("/admin/calificaciones/");
  }

  return adminPage("Eliminar calificación", `
    <section class="panel danger-panel">
      <div class="panel-header">
        <span class="hero-kicker">Admin</span>
        <h1 class="panel-title">Eliminar calificación</h1>
        <p class="panel-copy">Confirma la eliminación de <strong>${escapeHtml(grade.nombre_estudiante)}</strong> en ${escapeHtml(grade.asignatura)}.</p>
      </div>
      <form method="post" class="button-row">
        <button class="button danger" type="submit">Eliminar</button>
        <a class="button secondary" href="/admin/calificaciones/editar/${id}/">Cancelar</a>
      </form>
    </section>`, user);
}

function homePage(user) {
  return htmlPage("Inicio", `
    <section class="home-hero">
      <div class="home-grid">
        <article class="panel home-copy-card">
          <span class="hero-kicker">Plataforma académica</span>
          <h1 class="hero-title">Sistema de calificaciones para consultar, registrar y administrar notas con claridad.</h1>
          <p class="hero-copy">Gestiona acceso por roles, consulta promedios y trabaja con una interfaz simple para estudiantes, docentes y administradores.</p>
          <div class="button-row home-actions">
            ${user ? '<a class="button" href="/calificaciones/">Ir a calificaciones</a><a class="button secondary" href="/promedio-general/">Promedio general</a>' : '<a class="button" href="/login/">Iniciar sesión</a><a class="button secondary" href="/registro/">Crear cuenta</a>'}
          </div>
        </article>
        <article class="panel home-highlight-card">
          <div class="highlight-block">
            <span class="summary-label">Acceso</span>
            <strong class="highlight-title">${user ? `Sesión activa para ${escapeHtml(user.username)}` : "Ingreso y registro centralizados"}</strong>
            <p class="summary-copy">${user ? "Desde aquí puedes entrar al módulo principal, revisar promedios y continuar con tus permisos asignados." : "Inicia sesión, crea tu cuenta o recupera tu contraseña desde un mismo punto de entrada."}</p>
          </div>
          <div class="feature-list">
            <div class="feature-item"><strong>Roles por usuario</strong><p>Administrador, Docente y Estudiante con permisos diferenciados.</p></div>
            <div class="feature-item"><strong>Promedios automáticos</strong><p>El sistema calcula resultados individuales y el promedio general.</p></div>
            <div class="feature-item"><strong>Recuperación segura</strong><p>Restablece acceso por correo desde el flujo de autenticación.</p></div>
          </div>
        </article>
      </div>
    </section>`, user);
}

function metricCard(label, value, copy) {
  return `
    <article class="panel metric-card">
      <span class="summary-label">${escapeHtml(label)}</span>
      <strong class="summary-value">${escapeHtml(value)}</strong>
      <p class="summary-copy">${escapeHtml(copy)}</p>
    </article>`;
}

function adminUsersTable(rows, currentUser) {
  if (!rows.length) return "<p>No hay usuarios registrados.</p>";
  return `
    <div class="table-wrap"><table>
      <thead><tr><th>ID</th><th>Usuario</th><th>Email</th><th>Rol</th><th>Creado</th><th>Acción</th></tr></thead>
      <tbody>${rows.map((row) => `
        <tr>
          <td>${row.id}</td>
          <td>${escapeHtml(row.username)}${row.id === currentUser.id ? " <strong>(tú)</strong>" : ""}</td>
          <td>${escapeHtml(displayEmail(row.email))}</td>
          <td>${escapeHtml(row.role)}</td>
          <td>${escapeHtml(row.created_at || "")}</td>
          <td>
            <form class="role-form" method="post" action="/admin/users/role/">
              <input type="hidden" name="user_id" value="${row.id}">
              <select class="form-control compact-select" name="role">
                ${Object.values(ROLES).map((role) => `<option value="${role}"${role === row.role ? " selected" : ""}>${role}</option>`).join("")}
              </select>
              <button class="button button-compact" type="submit">Guardar</button>
            </form>
          </td>
        </tr>`).join("")}</tbody>
    </table></div>`;
}

function displayEmail(email) {
  return email === "admin@workers.local" ? "admin@sistema.local" : email;
}

function gradeTable(rows, user) {
  if (!rows.length) return "<p>No hay calificaciones registradas.</p>";
  const actions = canEdit(user) || canDelete(user);
  return `
    <div class="table-wrap"><table>
      <thead><tr><th>ID</th><th>Estudiante</th><th>Identificación</th><th>Asignatura</th><th>Nota 1</th><th>Nota 2</th><th>Nota 3</th><th>Promedio</th>${actions ? "<th>Acciones</th>" : ""}</tr></thead>
      <tbody>${rows.map((g) => `
        <tr>
          <td>${g.id}</td><td>${escapeHtml(g.nombre_estudiante)}</td><td>${escapeHtml(g.identificacion)}</td><td>${escapeHtml(g.asignatura)}</td>
          <td>${fmt(g.nota1)}</td><td>${fmt(g.nota2)}</td><td>${fmt(g.nota3)}</td><td>${fmt(g.promedio)}</td>
          ${actions ? `<td class="actions">${canEdit(user) ? `<a href="/calificaciones/editar/${g.id}/">Editar</a>` : ""}${canDelete(user) ? `<a href="/calificaciones/eliminar/${g.id}/">Eliminar</a>` : ""}</td>` : ""}
        </tr>`).join("")}</tbody>
    </table></div>`;
}

function adminGradeTable(rows) {
  if (!rows.length) return "<p>No hay calificaciones registradas.</p>";
  return `
    <div class="table-wrap"><table>
      <thead><tr><th>ID</th><th>Estudiante</th><th>Identificación</th><th>Asignatura</th><th>Nota 1</th><th>Nota 2</th><th>Nota 3</th><th>Promedio</th><th>Acciones</th></tr></thead>
      <tbody>${rows.map((g) => `
        <tr>
          <td>${g.id}</td><td>${escapeHtml(g.nombre_estudiante)}</td><td>${escapeHtml(g.identificacion)}</td><td>${escapeHtml(g.asignatura)}</td>
          <td>${fmt(g.nota1)}</td><td>${fmt(g.nota2)}</td><td>${fmt(g.nota3)}</td><td>${fmt(g.promedio)}</td>
          <td class="actions"><a href="/admin/calificaciones/editar/${g.id}/">Editar</a><a href="/admin/calificaciones/eliminar/${g.id}/">Eliminar</a></td>
        </tr>`).join("")}</tbody>
    </table></div>`;
}

function gradeForm(action, values = {}, errors = []) {
  return `
    <section class="panel">
      <div class="panel-header">
        <h1 class="panel-title">${action.includes("editar") ? "Editar" : "Crear"} calificación</h1>
      </div>
      ${errorList(errors)}
      <form method="post" action="${action}" class="form-stack">
        ${input("nombre_estudiante", "Nombre del estudiante", values.nombre_estudiante)}
        ${input("identificacion", "Identificación", values.identificacion)}
        ${input("asignatura", "Asignatura", values.asignatura)}
        ${input("nota1", "Nota 1", values.nota1, "number", "0", "5", "0.01")}
        ${input("nota2", "Nota 2", values.nota2, "number", "0", "5", "0.01")}
        ${input("nota3", "Nota 3", values.nota3, "number", "0", "5", "0.01")}
        <div class="button-row">
          <button class="button" type="submit">Guardar</button>
          <a class="button secondary" href="/calificaciones/">Cancelar</a>
        </div>
      </form>
    </section>`;
}

function adminGradeFormHtml(isChange, values = {}, errors = [], id = null) {
  const action = isChange ? `/admin/calificaciones/editar/${id}/` : "/admin/calificaciones/crear/";
  return `
    <section class="panel">
      <div class="panel-header">
        <span class="hero-kicker">Admin</span>
        <h1 class="panel-title">${isChange ? "Editar" : "Crear"} calificación</h1>
        <p class="panel-copy">El promedio se calcula automáticamente desde las tres notas.</p>
      </div>
      ${errorList(errors)}
      <form method="post" action="${action}" class="form-stack">
        ${input("nombre_estudiante", "Nombre del estudiante", values.nombre_estudiante)}
        ${input("identificacion", "Identificación", values.identificacion)}
        ${input("asignatura", "Asignatura", values.asignatura)}
        ${input("nota1", "Nota 1", values.nota1, "number", "0", "5", "0.01")}
        ${input("nota2", "Nota 2", values.nota2, "number", "0", "5", "0.01")}
        ${input("nota3", "Nota 3", values.nota3, "number", "0", "5", "0.01")}
        ${isChange ? `<div class="summary"><strong>Promedio actual:</strong> ${fmt(values.promedio)}</div>` : ""}
        <div class="button-row">
          <button class="button" type="submit">Guardar</button>
          <a class="button secondary" href="/admin/calificaciones/">Cancelar</a>
          ${isChange ? `<a class="button danger" href="/admin/calificaciones/eliminar/${id}/">Eliminar</a>` : ""}
        </div>
      </form>
    </section>`;
}

function authForm(kind, action, button, errors = [], values = {}, message = "") {
  const isRegister = kind === "registro";
  const title = isRegister ? "Registro de usuario" : "Iniciar sesión";
  const copy = isRegister
    ? "Crea tu cuenta para consultar tus notas y recuperar acceso con tu correo electrónico."
    : "Accede para revisar calificaciones, gestionar registros y consultar promedios.";
  return `
    <section class="auth-layout">
    <article class="panel ${isRegister ? "auth-card auth-card-wide" : "auth-card"}">
      <div class="panel-header">
        <h1 class="panel-title">${title}</h1>
        <p class="panel-copy">${copy}</p>
      </div>
      ${message ? `<ul class="messages"><li>${escapeHtml(message)}</li></ul>` : ""}
      ${errorList(errors)}
      <form method="post" action="${action}" class="form-stack">
        ${input("username", "Nombre de usuario", values.username)}
        ${isRegister ? input("email", "Correo electrónico", values.email, "email") : ""}
        ${input(isRegister ? "password1" : "password", "Contraseña", "", "password")}
        ${isRegister ? '<ul class="help-list"><li>Mínimo 8 caracteres.</li><li>Evita datos personales.</li><li>No uses contraseñas comunes ni solo números.</li></ul>' : ""}
        ${isRegister ? input("password2", "Confirmar contraseña", "", "password") : ""}
        <button class="button" type="submit">${button}</button>
      </form>
      <div class="auth-links">
        ${isRegister ? '<p>¿Ya tienes cuenta? <a href="/login/">Inicia sesión</a></p>' : '<a href="/password-reset/">¿Olvidaste tu contraseña?</a><p>¿No tienes cuenta? <a href="/registro/">Regístrate</a></p>'}
      </div>
    </article>
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
  if (values.nombre_estudiante.length < 3 || /^\d+$/.test(values.nombre_estudiante)) errors.push("El nombre del estudiante debe tener al menos 3 caracteres y no puede ser solo numérico.");
  if (!/^\d{5,15}$/.test(values.identificacion)) errors.push("La identificación debe contener entre 5 y 15 dígitos numéricos.");
  if (values.asignatura.length < 3 || /^\d+$/.test(values.asignatura)) errors.push("La asignatura debe tener al menos 3 caracteres y no puede ser solo numérica.");
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
    const err = new Error("No tienes permisos para acceder a esta página.");
    err.status = 403;
    throw err;
  }
}

async function hashPassword(password) {
  const bytes = new TextEncoder().encode(password);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function adminPage(title, content, user = null, status = 200) {
  return htmlPage(title, content, user, status, "/admin/");
}

function htmlPage(title, content, user = null, status = 200, activePath = "/") {
  return new Response(`<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <style>
    :root { color-scheme: light; --background: #f8fafc; --background-soft: #eef4ff; --surface: rgba(255,255,255,.92); --surface-strong: #fff; --foreground: #0f172a; --muted: #64748b; --border: #dbe4f0; --border-strong: #cbd5e1; --primary: #2563eb; --primary-hover: #1d4ed8; --secondary-surface: #f1f5f9; --danger: #dc2626; --success: #166534; --success-soft: #dcfce7; --shadow-soft: 0 18px 40px rgba(15,23,42,.08); --shadow-card: 0 8px 20px rgba(15,23,42,.06); --radius-xl: 24px; --radius-lg: 18px; --radius-md: 14px; --font-sans: Bahnschrift, "Segoe UI Variable", "Segoe UI", "Helvetica Neue", Arial, sans-serif; }
    *, *::before, *::after { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; background: radial-gradient(circle at top, rgba(37,99,235,.12), transparent 28%), linear-gradient(180deg, var(--background) 0%, var(--background-soft) 100%); color: var(--foreground); font-family: var(--font-sans); line-height: 1.5; }
    a { color: var(--primary); text-decoration: none; } a:hover { color: var(--primary-hover); }
    h1, h2 { color: var(--foreground); letter-spacing: -.03em; } h2 { margin: 0; font-size: 1.25rem; }
    .site-header { position: sticky; top: 0; z-index: 20; border-bottom: 1px solid rgba(219,228,240,.92); background: rgba(248,250,252,.88); backdrop-filter: blur(18px); }
    .site-nav { display: flex; align-items: center; justify-content: space-between; gap: 1rem; max-width: 1100px; margin: 0 auto; padding: 1rem 1.25rem; }
    .brand { display: inline-flex; align-items: center; gap: .875rem; color: var(--foreground); } .brand:hover { color: var(--foreground); }
    .brand-mark { width: 2.5rem; height: 2.5rem; border-radius: 16px; background: linear-gradient(135deg, var(--primary) 0%, #60a5fa 100%); box-shadow: inset 0 1px 0 rgba(255,255,255,.4); }
    .brand-copy { display: flex; flex-direction: column; line-height: 1.1; } .brand-copy strong { font-size: 1rem; } .brand-copy span { color: var(--muted); font-size: .875rem; }
    .nav-links, .button-row, .actions, .auth-links { display: flex; flex-wrap: wrap; gap: .75rem; }
    .nav-links { align-items: center; justify-content: flex-end; }
    .nav-link { padding: .65rem .95rem; border-radius: 999px; color: var(--muted); font-size: .95rem; font-weight: 600; }
    .nav-link:hover, .nav-link.active { color: var(--foreground); background: rgba(255,255,255,.8); box-shadow: inset 0 0 0 1px rgba(219,228,240,.92); }
    .inline-form { margin: 0; }
    .app-shell { max-width: 1100px; margin: 0 auto; padding: 2rem 1.25rem 3rem; }
    .panel { border: 1px solid rgba(219,228,240,.92); border-radius: var(--radius-xl); background: var(--surface); box-shadow: var(--shadow-soft); padding: 1.75rem; }
    .page-stack { display: flex; flex-direction: column; gap: 1.5rem; }
    .panel-header-inline { display: flex; align-items: center; justify-content: space-between; gap: 1rem; }
    .panel-header { display: flex; flex-direction: column; gap: .25rem; margin-bottom: 1.25rem; }
    .panel-title { margin: 0; font-size: clamp(1.45rem,2.2vw,1.85rem); letter-spacing: -.03em; }
    .home-grid { display: grid; grid-template-columns: minmax(0,1.35fr) minmax(0,.95fr); gap: 1.5rem; }
    .hero-kicker, .summary-label { color: var(--muted); font-size: .82rem; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
    .hero-kicker { display: inline-flex; width: fit-content; min-height: 2rem; padding: .35rem .75rem; border: 1px solid var(--border); border-radius: 999px; background: rgba(255,255,255,.88); }
    .hero-title { margin: 1rem 0 0; font-size: clamp(2.2rem,4.6vw,3.5rem); line-height: 1.02; letter-spacing: -.05em; }
    .hero-copy, .summary-copy, .panel-copy, .help-text, .auth-links p, .feature-item p { margin: .5rem 0 0; color: var(--muted); font-size: .97rem; }
    .home-actions { margin-top: 1.5rem; } .highlight-block { padding-bottom: 1.25rem; border-bottom: 1px solid var(--border); }
    .highlight-title { display: block; margin-top: .5rem; font-size: 1.4rem; line-height: 1.2; letter-spacing: -.03em; }
    .feature-list { display: flex; flex-direction: column; gap: 1rem; margin-top: 1.25rem; } .feature-item { padding: 1rem; border: 1px solid var(--border); border-radius: var(--radius-md); background: rgba(255,255,255,.72); }
    .admin-metrics, .admin-actions-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 1rem; } .admin-actions-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .admin-actions-grid .panel { display: flex; flex-direction: column; align-items: flex-start; }
    .admin-actions-grid .button-row { margin-top: 1.35rem; }
    .metric-card .summary-value { display: block; margin-top: .45rem; font-size: clamp(1.8rem,4vw,2.75rem); font-weight: 700; letter-spacing: -.05em; }
    .status-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: .75rem; margin-top: 1rem; } .status-grid div { border: 1px solid var(--border); border-radius: var(--radius-md); background: rgba(255,255,255,.72); padding: 1rem; } .status-grid strong, .status-grid span { display: block; } .status-grid span { color: var(--muted); margin-top: .25rem; }
    .auth-layout { display: flex; justify-content: center; } .auth-card { width: min(100%,480px); } .auth-card-wide { width: min(100%,560px); }
    .form-stack { display: flex; flex-direction: column; gap: 1rem; } .form-field { display: flex; flex-direction: column; gap: .45rem; } .form-label { font-size: .95rem; font-weight: 700; }
    .form-control, input, select { width: 100%; min-height: 3rem; padding: .85rem .95rem; border: 1px solid var(--border-strong); border-radius: var(--radius-md); background: rgba(255,255,255,.96); color: var(--foreground); font: inherit; }
    .button, button.button { display: inline-flex; align-items: center; justify-content: center; min-height: 2.9rem; padding: .8rem 1.15rem; border: 0; border-radius: 14px; background: var(--primary); color: #fff; cursor: pointer; font: inherit; font-weight: 700; text-decoration: none; }
    .button:hover, button.button:hover { background: var(--primary-hover); color: #fff; } .button.secondary { background: var(--secondary-surface); color: var(--foreground); } .button.danger { background: var(--danger); }
    .button.ghost { background: transparent; color: var(--foreground); box-shadow: inset 0 0 0 1px var(--border); } .button-compact { min-height: 2.5rem; padding: .65rem .95rem; border-radius: 12px; font-size: .92rem; }
    .messages, .field-errors, .help-list { list-style: none; margin: 0; padding: 0; } .messages li { background: var(--success-soft); border: 1px solid #86efac; border-radius: var(--radius-md); color: var(--success); margin-bottom: .85rem; padding: .95rem 1rem; }
    .field-errors li { background: #fef2f2; border: 1px solid #fecaca; border-radius: var(--radius-md); color: #991b1b; margin-bottom: .4rem; padding: .75rem; } .help-list { display: flex; flex-direction: column; gap: .3rem; color: var(--muted); font-size: .92rem; }
    .table-panel { display: flex; flex-direction: column; gap: 1rem; }
    .table-wrap { overflow-x: auto; border: 1px solid var(--border); border-radius: var(--radius-lg); background: #fff; } table { width: 100%; border-collapse: separate; border-spacing: 0; } th, td { border-bottom: 1px solid var(--border); padding: 1rem; text-align: left; white-space: nowrap; } th { background: #f8fafc; color: var(--muted); font-size: .82rem; text-transform: uppercase; } tbody tr:last-child td { border-bottom: 0; }
    .role-form { display: flex; align-items: center; gap: .5rem; margin: 0; } .compact-select { min-height: 2.5rem; min-width: 11rem; padding: .55rem .75rem; }
    .summary { background: #eff6ff; border: 1px solid #bfdbfe; border-radius: var(--radius-md); margin-top: 18px; padding: 14px; } .danger-panel { border-color: #fecaca; }
    @media (max-width: 780px) { .site-nav, .panel-header-inline { flex-direction: column; align-items: flex-start; } .home-grid, .admin-metrics, .admin-actions-grid, .status-grid { grid-template-columns: 1fr; } .nav-links { width: 100%; justify-content: flex-start; } .button-row, .actions { width: 100%; flex-direction: column; align-items: stretch; } .button, button.button { width: 100%; } .button.ghost.button-compact { width: auto; } .role-form { align-items: stretch; flex-direction: column; } }
  </style>
</head>
<body>
  <header class="site-header">
    <div class="site-nav">
      <a class="brand" href="/">
        <span class="brand-mark" aria-hidden="true"></span>
        <span class="brand-copy"><strong>${APP_NAME}</strong><span>Panel académico</span></span>
      </a>
      <div class="nav-links">${navLinks(user, activePath)}</div>
    </div>
  </header>
  <main class="app-shell">${content}</main>
</body>
</html>`, { status, headers: { "content-type": "text/html; charset=utf-8" } });
}

function navLinks(user, activePath = "/") {
  const isAdmin = activePath.startsWith("/admin/");
  const homeClass = isAdmin ? "nav-link" : "nav-link active";
  const adminClass = isAdmin ? "nav-link active" : "nav-link";
  if (!user) return `<a class="${homeClass}" href="/">Inicio</a><a class="${adminClass}" href="/admin/">Admin</a><a class="nav-link" href="/login/">Iniciar sesión</a><a class="nav-link" href="/registro/">Registro</a>`;
  return `
    <a class="${homeClass}" href="/">Inicio</a>
    <a class="${adminClass}" href="/admin/">Admin</a>
    <form class="inline-form" method="post" action="/logout/"><button class="button ghost button-compact" type="submit">Cerrar sesión</button></form>`;
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
  return `<div class="form-field"><label class="form-label" for="${name}">${label}</label><input class="form-control" ${attrs}></div>`;
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

function assertSameOriginPost(request) {
  if (request.method !== "POST") {
    const err = new Error("Método no permitido para esta acción.");
    err.status = 405;
    throw err;
  }

  const expected = new URL(request.url).origin;
  const origin = request.headers.get("origin");
  if (origin && origin !== expected) {
    const err = new Error("Origen de solicitud no permitido.");
    err.status = 403;
    throw err;
  }

  const referer = request.headers.get("referer");
  if (!origin && referer) {
    try {
      if (new URL(referer).origin !== expected) {
        const err = new Error("Origen de solicitud no permitido.");
        err.status = 403;
        throw err;
      }
    } catch (error) {
      if (error.status) throw error;
    }
  }
}

function finalizeResponse(response, dbContext) {
  const headers = new Headers(response.headers);
  headers.set("cache-control", "no-store");
  const bookmark = sessionBookmark(dbContext.session);
  if (bookmark) {
    headers.append("set-cookie", `${D1_BOOKMARK_COOKIE}=${encodeURIComponent(bookmark)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_TTL_SECONDS}`);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function sessionBookmark(session) {
  if (!session || typeof session.getBookmark !== "function") return "";
  const value = session.getBookmark();
  if (!value) return "";
  if (typeof value === "string") return value;
  return value.bookmark || "";
}

function redirect(location, cookies = [], status = 303) {
  const headers = new Headers({ location });
  for (const cookie of Array.isArray(cookies) ? cookies : [cookies]) {
    if (cookie) headers.append("set-cookie", cookie);
  }
  return new Response(null, { status, headers });
}

function cookieHeader(token, expiresAt) {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${expiresAt - Math.floor(Date.now() / 1000)}`;
}

function expiredSessionCookie() {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

function getCookie(request, name) {
  const cookie = request.headers.get("cookie") || "";
  return cookie.split(";").map((v) => v.trim()).find((v) => v.startsWith(`${name}=`))?.slice(name.length + 1) || "";
}

function decodeCookieValue(value) {
  if (!value) return "";
  try {
    return decodeURIComponent(value);
  } catch {
    return "";
  }
}

function safeNextPath(value, fallback) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return fallback;
  return normalizePath(value.split("#")[0]);
}

function normalizePath(path) {
  return path.endsWith("/") ? path : `${path}/`;
}

function idFromPath(path, fromEnd = 0) {
  return Number(path.split("/").filter(Boolean).at(-1 - fromEnd));
}

function isAdminGradeListPath(path) {
  return path === "/admin/calificaciones/" || path === "/admin/calificaciones_nombre__estudiantes/calificacion/";
}

function isAdminGradeCreatePath(path) {
  return path === "/admin/calificaciones/crear/" || path === "/admin/calificaciones_nombre__estudiantes/calificacion/add/";
}

function isAdminGradeEditPath(path) {
  return path.startsWith("/admin/calificaciones/editar/") || (path.startsWith("/admin/calificaciones_nombre__estudiantes/calificacion/") && path.endsWith("/change/"));
}

function isAdminGradeDeletePath(path) {
  return path.startsWith("/admin/calificaciones/eliminar/") || (path.startsWith("/admin/calificaciones_nombre__estudiantes/calificacion/") && path.endsWith("/delete/"));
}

function adminGradeId(path) {
  if (path.includes("/calificaciones_nombre__estudiantes/")) return idFromPath(path, 1);
  return idFromPath(path);
}

function clean(value) {
  return String(value || "").trim();
}

function fmt(value) {
  return Number(value || 0).toFixed(2);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
