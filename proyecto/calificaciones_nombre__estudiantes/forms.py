from django import forms
from django.contrib.auth.forms import AuthenticationForm, UserCreationForm
from django.contrib.auth.models import User

from .models import Calificacion


class CalificacionForm(forms.ModelForm):
    def clean_nombre_estudiante(self):
        nombre = self.cleaned_data["nombre_estudiante"].strip()
        if len(nombre) < 3:
            raise forms.ValidationError(
                "El nombre del estudiante debe tener al menos 3 caracteres."
            )
        if nombre.isdigit():
            raise forms.ValidationError(
                "El nombre del estudiante no puede contener solo números."
            )
        return nombre

    def clean_asignatura(self):
        asignatura = self.cleaned_data["asignatura"].strip()
        if len(asignatura) < 3:
            raise forms.ValidationError(
                "La asignatura debe tener al menos 3 caracteres."
            )
        if asignatura.isdigit():
            raise forms.ValidationError("La asignatura no puede contener solo números.")
        return asignatura

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
        min_length=3,
        max_length=30,
        help_text="Requerido. Usa entre 3 y 30 caracteres.",
        error_messages={
            "unique": "Ya existe un usuario con ese nombre.",
            "max_length": "El nombre de usuario no puede superar 30 caracteres.",
            "min_length": "El nombre de usuario debe tener al menos 3 caracteres.",
        },
    )
    password1 = forms.CharField(
        label="Contraseña",
        strip=False,
        widget=forms.PasswordInput(attrs={"autocomplete": "new-password"}),
        help_text="",
    )
    password2 = forms.CharField(
        label="Confirmar contraseña",
        strip=False,
        widget=forms.PasswordInput(attrs={"autocomplete": "new-password"}),
        help_text="Repite la contraseña para confirmarla.",
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

