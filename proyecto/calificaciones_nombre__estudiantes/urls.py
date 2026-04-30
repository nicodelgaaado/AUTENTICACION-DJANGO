from django.contrib.auth.views import (
    LoginView,
    LogoutView,
    PasswordResetCompleteView,
    PasswordResetConfirmView,
    PasswordResetDoneView,
    PasswordResetView,
)
from django.urls import path

from .forms import CambioPasswordForm, InicioSesionForm, RecuperacionPasswordForm
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
    path(
        "password-reset/",
        PasswordResetView.as_view(
            form_class=RecuperacionPasswordForm,
            template_name="registration/recuperar_contrasena.html",
            email_template_name="registration/recuperar_contrasena_email.html",
            subject_template_name="registration/recuperar_contrasena_asunto.txt",
            success_url="/password-reset/done/",
        ),
        name="password_reset",
    ),
    path(
        "password-reset/done/",
        PasswordResetDoneView.as_view(
            template_name="registration/recuperar_contrasena_enviada.html",
        ),
        name="password_reset_done",
    ),
    path(
        "reset/<uidb64>/<token>/",
        PasswordResetConfirmView.as_view(
            form_class=CambioPasswordForm,
            template_name="registration/cambiar_contrasena.html",
            success_url="/reset/done/",
        ),
        name="password_reset_confirm",
    ),
    path(
        "reset/done/",
        PasswordResetCompleteView.as_view(
            template_name="registration/contrasena_actualizada.html",
        ),
        name="password_reset_complete",
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
