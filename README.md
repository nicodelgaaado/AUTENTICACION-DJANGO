# AUTENTICACION-DJANGO

Aplicacion Django para gestionar calificaciones de estudiantes con autenticacion, roles y calculo automatico de promedios.

## Funcionalidades

- Registro de usuarios con `UserCreationForm`.
- Inicio y cierre de sesion con las vistas nativas de Django.
- Recuperacion de contrasena por email con las vistas nativas de Django.
- CRUD de calificaciones protegido por autenticacion.
- Roles basicos con grupos de Django: `Administrador`, `Docente` y `Estudiante`.
- Calculo automatico del promedio individual en el modelo `Calificacion`.
- Calculo del promedio general con `Avg` de Django.
- Administracion del modelo `Calificacion` desde `/admin/`.
- Pruebas funcionales para registro, permisos por rol y calculo de promedios.

## Estructura principal

```text
proyecto/
  manage.py
  proyecto/
    settings.py
    urls.py
  calificaciones_nombre__estudiantes/
    admin.py
    forms.py
    models.py
    tests.py
    urls.py
    views.py
    templates/
      base.html
      registration/
      calificaciones/
```

## Requisitos

- Python instalado.
- Django instalado en el entorno de trabajo.

Si Django no esta instalado:

```powershell
python -m pip install django
```

## Instalacion y ejecucion

Desde la raiz del repositorio:

```powershell
cd proyecto
python manage.py makemigrations
python manage.py migrate
python manage.py createsuperuser
python manage.py runserver
```

Luego abrir:

```text
http://127.0.0.1:8000/
```

## Rutas disponibles

| Ruta | Nombre | Descripcion |
| --- | --- | --- |
| `/admin/` | admin | Panel administrativo de Django |
| `/login/` | login | Inicio de sesion |
| `/logout/` | logout | Cierre de sesion |
| `/registro/` | registro | Registro de usuario |
| `/password-reset/` | password_reset | Solicitar recuperacion de contrasena |
| `/password-reset/done/` | password_reset_done | Confirmacion de envio |
| `/reset/<uidb64>/<token>/` | password_reset_confirm | Definir nueva contrasena |
| `/reset/done/` | password_reset_complete | Recuperacion finalizada |
| `/calificaciones/` | listar_calificaciones | Listado de calificaciones |
| `/calificaciones/crear/` | crear_calificacion | Crear calificacion |
| `/calificaciones/editar/<id>/` | editar_calificacion | Editar calificacion |
| `/calificaciones/eliminar/<id>/` | eliminar_calificacion | Eliminar calificacion |
| `/promedio-general/` | promedio_general | Ver promedio general |

## Modelo Calificacion

El modelo principal conserva los campos del laboratorio:

- `nombre_estudiante`
- `identificacion`
- `asignatura`
- `nota1`
- `nota2`
- `nota3`
- `promedio`

El campo `promedio` no se edita desde el formulario. Se calcula automaticamente al guardar:

```python
def calcular_promedio(self):
    return round((self.nota1 + self.nota2 + self.nota3) / 3, 2)
```

## Roles y permisos

Los permisos se validan en `views.py`; no dependen solo de ocultar botones en HTML.

| Rol | Permisos |
| --- | --- |
| Administrador | Crear, listar, editar, eliminar y ver promedio general |
| Docente | Crear, listar, editar y ver promedio general |
| Estudiante | Listar y ver promedio general |

El superusuario de Django tambien puede acceder a las vistas protegidas.

## Crear grupos y asignar usuarios

1. Ejecutar migraciones y crear superusuario:

```powershell
python manage.py migrate
python manage.py createsuperuser
```

2. Iniciar servidor:

```powershell
python manage.py runserver
```

3. Entrar a:

```text
http://127.0.0.1:8000/admin/
```

4. Crear los grupos con estos nombres exactos:

- `Administrador`
- `Docente`
- `Estudiante`

5. Entrar a cada usuario desde el admin y asignarlo al grupo correspondiente.

Los usuarios creados desde `/registro/` se agregan automaticamente al grupo `Estudiante`.

## Recuperacion de contrasena por SMTP

El formulario de registro exige correo electronico unico. Ese correo se usa para enviar el enlace seguro de recuperacion de contrasena.

Configura estas variables de entorno antes de ejecutar el servidor si vas a enviar correos reales:

```powershell
$env:EMAIL_HOST="smtp.tu-proveedor.com"
$env:EMAIL_PORT="587"
$env:EMAIL_HOST_USER="usuario-smtp"
$env:EMAIL_HOST_PASSWORD="clave-smtp"
$env:EMAIL_USE_TLS="True"
$env:EMAIL_USE_SSL="False"
$env:DEFAULT_FROM_EMAIL="Sistema Calificaciones <no-reply@tu-dominio.com>"
python manage.py runserver
```

No guardes credenciales SMTP en el repositorio. Los usuarios existentes sin correo deben actualizarse desde `/admin/` antes de usar la recuperacion de contrasena.

## Operacion basica

1. Crear o iniciar sesion con un usuario.
2. Asignar el usuario a un grupo desde `/admin/` si necesita permisos de `Administrador` o `Docente`.
3. Usar `/calificaciones/` para consultar registros.
4. Usar `/calificaciones/crear/` para registrar notas si el rol lo permite.
5. Usar las acciones de editar o eliminar desde el listado segun el rol.
6. Revisar `/promedio-general/` para consultar el promedio total.

## Pruebas

Ejecutar:

```powershell
cd proyecto
python manage.py check
python manage.py makemigrations --check
python manage.py migrate
python manage.py test
```

Las pruebas cubren:

- Registro de usuario y asignacion automatica a `Estudiante`.
- Registro con correo obligatorio y unico.
- Recuperacion de contrasena con backend de correo en memoria durante tests.
- Redireccion de usuario no autenticado hacia login.
- Permisos de `Estudiante`.
- Permisos de `Docente`.
- Permisos de `Administrador`.
- Calculo de promedio individual y promedio general.

## Notas de versionamiento

El repositorio ignora archivos generados y locales como:

- `__pycache__/`
- `*.pyc`
- `db.sqlite3`
- entornos virtuales
- archivos `.env`

La base de datos local `db.sqlite3` no debe versionarse; cada entorno debe generarla con `python manage.py migrate`.
