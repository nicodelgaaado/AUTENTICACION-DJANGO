from django import forms
from django.contrib.auth.forms import (
    AuthenticationForm,
    PasswordResetForm,
    SetPasswordForm,
    UserCreationForm,
)
from django.contrib.auth.models import User

from .models import Calificacion


class StyledFormMixin:
    base_input_class = "form-control"
    field_placeholders = {}

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        for field_name, field in self.fields.items():
            widget = field.widget
            if widget.is_hidden:
                continue

            current_classes = widget.attrs.get("class", "").split()
            if self.base_input_class not in current_classes:
                current_classes.append(self.base_input_class)
            widget.attrs["class"] = " ".join(current_classes)

            placeholder = self.field_placeholders.get(field_name)
            if placeholder:
                widget.attrs.setdefault("placeholder", placeholder)

            if isinstance(widget, forms.NumberInput):
                widget.attrs.setdefault("inputmode", "decimal")


class CalificacionForm(StyledFormMixin, forms.ModelForm):
    field_placeholders = {
        "nombre_estudiante": "Nombre completo del estudiante",
        "identificacion": "Identificación",
        "asignatura": "Asignatura",
        "nota1": "0.00",
        "nota2": "0.00",
        "nota3": "0.00",
    }

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.fields["identificacion"].widget.attrs.update({"inputmode": "numeric"})

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


class RegistroUsuarioForm(StyledFormMixin, UserCreationForm):
    error_messages = {
        "password_mismatch": "Las contraseñas no coinciden.",
    }
    field_placeholders = {
        "username": "Nombre de usuario",
        "email": "correo@ejemplo.com",
        "password1": "Crea una contraseña segura",
        "password2": "Repite la contraseña",
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


class InicioSesionForm(StyledFormMixin, AuthenticationForm):
    field_placeholders = {
        "username": "Ingresa tu usuario",
        "password": "Ingresa tu contraseña",
    }
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


class RecuperacionPasswordForm(StyledFormMixin, PasswordResetForm):
    field_placeholders = {
        "email": "correo@ejemplo.com",
    }
    email = forms.EmailField(
        label="Correo electrónico",
        max_length=254,
        widget=forms.EmailInput(attrs={"autocomplete": "email"}),
    )


class CambioPasswordForm(StyledFormMixin, SetPasswordForm):
    field_placeholders = {
        "new_password1": "Nueva contraseña",
        "new_password2": "Confirma la nueva contraseña",
    }
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
