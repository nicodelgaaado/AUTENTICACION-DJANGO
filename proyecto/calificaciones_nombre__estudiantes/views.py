from functools import wraps

from django.contrib import messages
from django.contrib.auth.models import Group
from django.contrib.auth.decorators import login_required
from django.db.models import Avg
from django.shortcuts import get_object_or_404, redirect, render

from .forms import CalificacionForm, RegistroUsuarioForm
from .models import Calificacion


GRUPO_ADMINISTRADOR = "Administrador"
GRUPO_DOCENTE = "Docente"
GRUPO_ESTUDIANTE = "Estudiante"


def usuario_en_grupo(user, grupos):
    if user.is_superuser:
        return True
    return user.groups.filter(name__in=grupos).exists()


def permisos_usuario(user):
    puede_crear = usuario_en_grupo(user, [GRUPO_ADMINISTRADOR, GRUPO_DOCENTE])
    puede_editar = usuario_en_grupo(user, [GRUPO_ADMINISTRADOR, GRUPO_DOCENTE])
    puede_eliminar = usuario_en_grupo(user, [GRUPO_ADMINISTRADOR])
    puede_listar = usuario_en_grupo(
        user,
        [GRUPO_ADMINISTRADOR, GRUPO_DOCENTE, GRUPO_ESTUDIANTE],
    )

    return {
        "puede_crear": puede_crear,
        "puede_editar": puede_editar,
        "puede_eliminar": puede_eliminar,
        "puede_listar": puede_listar,
        "puede_ver_promedio": puede_listar,
    }


def grupos_requeridos(*grupos):
    def decorador(view_func):
        @wraps(view_func)
        @login_required
        def wrapper(request, *args, **kwargs):
            if usuario_en_grupo(request.user, grupos):
                return view_func(request, *args, **kwargs)
            return render(
                request,
                "calificaciones/acceso_denegado.html",
                {"permisos": permisos_usuario(request.user)},
                status=403,
            )

        return wrapper

    return decorador


def contexto_base(request, **extra):
    contexto = {"permisos": permisos_usuario(request.user)}
    contexto.update(extra)
    return contexto


def registro(request):
    if request.method == "POST":
        form = RegistroUsuarioForm(request.POST)
        if form.is_valid():
            user = form.save()
            grupo_estudiante, _ = Group.objects.get_or_create(name=GRUPO_ESTUDIANTE)
            user.groups.add(grupo_estudiante)
            messages.success(
                request,
                "Usuario registrado correctamente. Ahora puedes iniciar sesión.",
            )
            return redirect("login")
        messages.error(request, "Corrige los errores del formulario de registro.")
    else:
        form = RegistroUsuarioForm()

    return render(request, "registration/registro.html", {"form": form})


@grupos_requeridos(GRUPO_ADMINISTRADOR, GRUPO_DOCENTE)
def crear_calificacion(request):
    if request.method == "POST":
        form = CalificacionForm(request.POST)
        if form.is_valid():
            form.save()
            messages.success(request, "Calificación creada correctamente.")
            return redirect("listar_calificaciones")
        messages.error(request, "Corrige los errores del formulario.")
    else:
        form = CalificacionForm()

    return render(
        request,
        "calificaciones/crear.html",
        contexto_base(request, form=form),
    )


@grupos_requeridos(GRUPO_ADMINISTRADOR, GRUPO_DOCENTE, GRUPO_ESTUDIANTE)
def listar_calificaciones(request):
    calificaciones = Calificacion.objects.all().order_by("id")
    promedio_general_valor = calificaciones.aggregate(Avg("promedio"))["promedio__avg"]
    hay_promedio = promedio_general_valor is not None

    return render(
        request,
        "calificaciones/listar.html",
        contexto_base(
            request,
            calificaciones=calificaciones,
            promedio_general=promedio_general_valor,
            hay_promedio=hay_promedio,
        ),
    )


@grupos_requeridos(GRUPO_ADMINISTRADOR, GRUPO_DOCENTE)
def editar_calificacion(request, id):
    calificacion = get_object_or_404(Calificacion, id=id)
    if request.method == "POST":
        form = CalificacionForm(request.POST, instance=calificacion)
        if form.is_valid():
            form.save()
            messages.success(request, "Calificación actualizada correctamente.")
            return redirect("listar_calificaciones")
        messages.error(request, "Corrige los errores del formulario.")
    else:
        form = CalificacionForm(instance=calificacion)

    return render(
        request,
        "calificaciones/editar.html",
        contexto_base(request, form=form, calificacion=calificacion),
    )


@grupos_requeridos(GRUPO_ADMINISTRADOR)
def eliminar_calificacion(request, id):
    calificacion = get_object_or_404(Calificacion, id=id)
    if request.method == "POST":
        calificacion.delete()
        messages.success(request, "Calificación eliminada correctamente.")
        return redirect("listar_calificaciones")

    return render(
        request,
        "calificaciones/eliminar.html",
        contexto_base(request, calificacion=calificacion),
    )


@grupos_requeridos(GRUPO_ADMINISTRADOR, GRUPO_DOCENTE, GRUPO_ESTUDIANTE)
def promedio_general(request):
    promedio_general_valor = Calificacion.objects.all().aggregate(Avg("promedio"))[
        "promedio__avg"
    ]
    hay_promedio = promedio_general_valor is not None

    return render(
        request,
        "calificaciones/promedio_general.html",
        contexto_base(
            request,
            promedio_general=promedio_general_valor,
            hay_promedio=hay_promedio,
        ),
    )
