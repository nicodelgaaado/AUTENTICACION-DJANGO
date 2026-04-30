from django.contrib.auth.views import LoginView, LogoutView
from django.urls import path

from .forms import InicioSesionForm
from . import views


urlpatterns = [
    path(
        "login/",
        LoginView.as_view(
            authentication_form=InicioSesionForm,
            template_name="registration/login.html",
        ),
        name="login",
    ),
    path(
        "logout/",
        LogoutView.as_view(template_name="registration/logged_out.html"),
        name="logout",
    ),
    path("registro/", views.registro, name="registro"),
    path("calificaciones/", views.listar_calificaciones, name="listar_calificaciones"),
    path(
        "calificaciones/crear/",
        views.crear_calificacion,
        name="crear_calificacion",
    ),
    path(
        "calificaciones/editar/<int:id>/",
        views.editar_calificacion,
        name="editar_calificacion",
    ),
    path(
        "calificaciones/eliminar/<int:id>/",
        views.eliminar_calificacion,
        name="eliminar_calificacion",
    ),
    path("promedio-general/", views.promedio_general, name="promedio_general"),
]
