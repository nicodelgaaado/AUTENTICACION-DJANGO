from django import forms
from django.contrib.auth.forms import (
    AuthenticationForm,
    PasswordResetForm,
    SetPasswordForm,
    UserCreationForm,
)
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
    email = forms.EmailField(
        label="Correo electrónico",
        help_text="Se usará para recuperar tu contraseña.",
        error_messages={
            "required": "El correo electrónico es obligatorio.",
            "invalid": "Ingresa un correo electrónico válido.",
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
        fields = ("username", "email")

    def clean_email(self):
        email = self.cleaned_data["email"].strip().lower()
        if User.objects.filter(email__iexact=email).exists():
            raise forms.ValidationError("Ya existe un usuario con ese correo.")
        return email

    def save(self, commit=True):
        user = super().save(commit=False)
        user.email = self.cleaned_data["email"]
        if commit:
            user.save()
        return user


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


class RecuperacionPasswordForm(PasswordResetForm):
    email = forms.EmailField(
        label="Correo electrónico",
        max_length=254,
        widget=forms.EmailInput(attrs={"autocomplete": "email"}),
    )


class CambioPasswordForm(SetPasswordForm):
    new_password1 = forms.CharField(
        label="Nueva contraseña",
        strip=False,
        widget=forms.PasswordInput(attrs={"autocomplete": "new-password"}),
        help_text="",
    )
    new_password2 = forms.CharField(
        label="Confirmar nueva contraseña",
        strip=False,
        widget=forms.PasswordInput(attrs={"autocomplete": "new-password"}),
        help_text="Repite la nueva contraseña para confirmarla.",
    )

