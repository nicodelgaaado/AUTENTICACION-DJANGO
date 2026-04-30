from django import forms
from django.contrib.auth.forms import AuthenticationForm, UserCreationForm
from django.contrib.auth.models import User

from .models import Calificacion


class CalificacionForm(forms.ModelForm):
    class Meta:
        model = Calificacion
        exclude = ("promedio",)
        labels = {
            "nombre_estudiante": "Nombre del estudiante",
            "identificacion": "Identificación",
            "asignatura": "Asignatura",
            "nota1": "Nota 1",
            "nota2": "Nota 2",
            "nota3": "Nota 3",
        }


class RegistroUsuarioForm(UserCreationForm):
    error_messages = {
        "password_mismatch": "Las contraseñas no coinciden.",
    }
    username = forms.CharField(
        label="Nombre de usuario",
        help_text="Requerido. Usa 150 caracteres o menos.",
        error_messages={
            "unique": "Ya existe un usuario con ese nombre.",
        },
    )
    password1 = forms.CharField(
        label="Contraseña",
        strip=False,
        widget=forms.PasswordInput(attrs={"autocomplete": "new-password"}),
        help_text=(
            "La contraseña no puede ser demasiado similar a tus datos, "
            "debe tener al menos 8 caracteres, no puede ser común y no "
            "puede ser solo numérica."
        ),
    )
    password2 = forms.CharField(
        label="Confirmar contraseña",
        strip=False,
        widget=forms.PasswordInput(attrs={"autocomplete": "new-password"}),
        help_text="Ingresa la misma contraseña para verificarla.",
    )

    class Meta:
        model = User
        fields = ("username",)


class InicioSesionForm(AuthenticationForm):
    username = forms.CharField(
        label="Nombre de usuario",
        widget=forms.TextInput(attrs={"autofocus": True}),
    )
    password = forms.CharField(
        label="Contraseña",
        strip=False,
        widget=forms.PasswordInput(attrs={"autocomplete": "current-password"}),
    )

    error_messages = {
        "invalid_login": (
            "Ingresa un nombre de usuario y contraseña correctos. "
            "Ten en cuenta que ambos campos distinguen mayúsculas y minúsculas."
        ),
        "inactive": "Esta cuenta está inactiva.",
    }

