from decimal import Decimal
import re

from django.contrib.auth.models import Group, User
from django.core import mail
from django.test import TestCase
from django.test.utils import override_settings
from django.urls import reverse

from .forms import CalificacionForm, RegistroUsuarioForm
from .models import Calificacion


class CalificacionesAutenticacionTests(TestCase):
    def setUp(self):
        self.grupo_admin = Group.objects.create(name="Administrador")
        self.grupo_docente = Group.objects.create(name="Docente")
        self.grupo_estudiante = Group.objects.create(name="Estudiante")

        self.admin = User.objects.create_user("admin", password="ClaveSegura123")
        self.docente = User.objects.create_user("docente", password="ClaveSegura123")
        self.estudiante = User.objects.create_user(
            "estudiante",
            password="ClaveSegura123",
        )

        self.admin.groups.add(self.grupo_admin)
        self.docente.groups.add(self.grupo_docente)
        self.estudiante.groups.add(self.grupo_estudiante)

        self.calificacion = Calificacion.objects.create(
            nombre_estudiante="Ana Perez",
            identificacion="10001",
            asignatura="Matematicas",
            nota1=Decimal("4.00"),
            nota2=Decimal("3.50"),
            nota3=Decimal("4.50"),
        )

    def test_registro_crea_usuario_estudiante_y_redirige_al_login(self):
        response = self.client.post(
            reverse("registro"),
            {
                "username": "nuevo",
                "email": "nuevo@example.com",
                "password1": "ClaveSegura123",
                "password2": "ClaveSegura123",
            },
        )

        self.assertRedirects(response, reverse("login"))
        usuario = User.objects.get(username="nuevo")
        self.assertEqual(usuario.email, "nuevo@example.com")
        self.assertTrue(usuario.groups.filter(name="Estudiante").exists())

    def test_login_y_registro_muestran_formularios_en_espanol(self):
        login_response = self.client.get(reverse("login"))
        registro_response = self.client.get(reverse("registro"))

        self.assertContains(login_response, "Nombre de usuario")
        self.assertContains(login_response, "Contraseña")
        self.assertContains(registro_response, "Confirmar contraseña")
        self.assertContains(registro_response, "entre 3 y 30 caracteres")
        self.assertContains(registro_response, "Mínimo 8 caracteres")
        self.assertNotContains(registro_response, "150 caracteres")

    def test_registro_rechaza_nombre_de_usuario_mayor_a_30_caracteres(self):
        form = RegistroUsuarioForm(
            data={
                "username": "usuario_con_nombre_demasiado_largo",
                "email": "largo@example.com",
                "password1": "ClaveSegura123",
                "password2": "ClaveSegura123",
            }
        )

        self.assertFalse(form.is_valid())
        self.assertIn("username", form.errors)

    def test_registro_requiere_email_y_rechaza_email_duplicado(self):
        User.objects.create_user(
            "con_email",
            email="duplicado@example.com",
            password="ClaveSegura123",
        )

        sin_email = RegistroUsuarioForm(
            data={
                "username": "sinemail",
                "password1": "ClaveSegura123",
                "password2": "ClaveSegura123",
            }
        )
        duplicado = RegistroUsuarioForm(
            data={
                "username": "duplicado",
                "email": "DUPLICADO@example.com",
                "password1": "ClaveSegura123",
                "password2": "ClaveSegura123",
            }
        )

        self.assertFalse(sin_email.is_valid())
        self.assertIn("email", sin_email.errors)
        self.assertFalse(duplicado.is_valid())
        self.assertIn("email", duplicado.errors)

    @override_settings(
        EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend",
        DEFAULT_FROM_EMAIL="sistema@example.com",
    )
    def test_recuperacion_de_contrasena_envia_email_y_permite_cambiarla(self):
        usuario = User.objects.create_user(
            "recuperable",
            email="recuperable@example.com",
            password="ClaveAnterior123",
        )

        login_response = self.client.get(reverse("login"))
        self.assertContains(login_response, "¿Olvidaste tu contraseña?")

        reset_response = self.client.post(
            reverse("password_reset"),
            {"email": usuario.email},
        )

        self.assertRedirects(reset_response, reverse("password_reset_done"))
        self.assertEqual(len(mail.outbox), 1)
        self.assertEqual(mail.outbox[0].subject, "Recuperación de contraseña")
        self.assertIn("recuperable", mail.outbox[0].body)

        reset_path = re.search(
            r"http://testserver(?P<path>/reset/.+/.+)/?",
            mail.outbox[0].body,
        ).group("path")
        confirm_response = self.client.get(reset_path)
        confirm_path = confirm_response.headers.get("Location", reset_path)

        cambio_response = self.client.post(
            confirm_path,
            {
                "new_password1": "ClaveNueva123",
                "new_password2": "ClaveNueva123",
            },
        )

        self.assertRedirects(cambio_response, reverse("password_reset_complete"))
        usuario.refresh_from_db()
        self.assertTrue(usuario.check_password("ClaveNueva123"))
        self.assertTrue(
            self.client.login(username="recuperable", password="ClaveNueva123")
        )

    def test_usuario_no_autenticado_no_accede_al_crud(self):
        response = self.client.get(reverse("listar_calificaciones"))

        self.assertEqual(response.status_code, 302)
        self.assertIn(reverse("login"), response.url)

    def test_home_muestra_index_para_anonimo_y_autenticado(self):
        response_anonimo = self.client.get(reverse("home"))
        self.assertEqual(response_anonimo.status_code, 200)
        self.assertContains(response_anonimo, "Sistema de calificaciones")
        self.assertContains(response_anonimo, "Iniciar sesión")

        self.client.force_login(self.estudiante)
        response_autenticado = self.client.get(reverse("home"))
        self.assertEqual(response_autenticado.status_code, 200)
        self.assertContains(response_autenticado, "Ir a calificaciones")
        self.assertContains(response_autenticado, "Promedio general")

    def test_estudiante_solo_lista_y_ve_promedio(self):
        self.client.force_login(self.estudiante)

        self.assertEqual(
            self.client.get(reverse("listar_calificaciones")).status_code,
            200,
        )
        self.assertEqual(self.client.get(reverse("promedio_general")).status_code, 200)
        self.assertEqual(self.client.get(reverse("crear_calificacion")).status_code, 403)
        self.assertEqual(
            self.client.get(
                reverse("editar_calificacion", args=[self.calificacion.id])
            ).status_code,
            403,
        )
        self.assertEqual(
            self.client.get(
                reverse("eliminar_calificacion", args=[self.calificacion.id])
            ).status_code,
            403,
        )

    def test_docente_crea_y_edita_pero_no_elimina(self):
        self.client.force_login(self.docente)

        crear_response = self.client.post(
            reverse("crear_calificacion"),
            {
                "nombre_estudiante": "Luis Gomez",
                "identificacion": "20002",
                "asignatura": "Fisica",
                "nota1": "5.00",
                "nota2": "4.00",
                "nota3": "3.00",
            },
        )

        self.assertRedirects(crear_response, reverse("listar_calificaciones"))
        nueva = Calificacion.objects.get(identificacion="20002")
        self.assertEqual(nueva.promedio, Decimal("4.00"))

        editar_response = self.client.post(
            reverse("editar_calificacion", args=[nueva.id]),
            {
                "nombre_estudiante": "Luis Gomez",
                "identificacion": "20002",
                "asignatura": "Fisica",
                "nota1": "4.00",
                "nota2": "4.00",
                "nota3": "4.00",
            },
        )

        self.assertRedirects(editar_response, reverse("listar_calificaciones"))
        nueva.refresh_from_db()
        self.assertEqual(nueva.promedio, Decimal("4.00"))

        eliminar_response = self.client.post(
            reverse("eliminar_calificacion", args=[nueva.id]),
        )

        self.assertEqual(eliminar_response.status_code, 403)
        self.assertTrue(Calificacion.objects.filter(id=nueva.id).exists())

    def test_administrador_puede_eliminar(self):
        self.client.force_login(self.admin)

        response = self.client.post(
            reverse("eliminar_calificacion", args=[self.calificacion.id]),
        )

        self.assertRedirects(response, reverse("listar_calificaciones"))
        self.assertFalse(Calificacion.objects.filter(id=self.calificacion.id).exists())

    def test_promedios_individual_y_general(self):
        Calificacion.objects.create(
            nombre_estudiante="Carlos Ruiz",
            identificacion="30003",
            asignatura="Historia",
            nota1=Decimal("3.00"),
            nota2=Decimal("3.00"),
            nota3=Decimal("3.00"),
        )
        self.calificacion.refresh_from_db()

        self.assertEqual(self.calificacion.promedio, Decimal("4.00"))

        self.client.force_login(self.estudiante)
        response = self.client.get(reverse("promedio_general"))

        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "3,50")

    def test_formulario_rechaza_datos_invalidos_de_calificacion(self):
        form = CalificacionForm(
            data={
                "nombre_estudiante": "12",
                "identificacion": "abc",
                "asignatura": "1",
                "nota1": "5.50",
                "nota2": "-1.00",
                "nota3": "4.00",
            }
        )

        self.assertFalse(form.is_valid())
        self.assertIn("nombre_estudiante", form.errors)
        self.assertIn("identificacion", form.errors)
        self.assertIn("asignatura", form.errors)
        self.assertIn("nota1", form.errors)
        self.assertIn("nota2", form.errors)

    def test_formulario_limpia_espacios_en_textos_validos(self):
        form = CalificacionForm(
            data={
                "nombre_estudiante": "  Maria Lopez  ",
                "identificacion": "123456",
                "asignatura": "  Quimica  ",
                "nota1": "4.50",
                "nota2": "4.00",
                "nota3": "3.50",
            }
        )

        self.assertTrue(form.is_valid(), form.errors)
        self.assertEqual(form.cleaned_data["nombre_estudiante"], "Maria Lopez")
        self.assertEqual(form.cleaned_data["asignatura"], "Quimica")
