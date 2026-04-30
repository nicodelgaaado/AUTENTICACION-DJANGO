from decimal import Decimal

from django.contrib.auth.models import Group, User
from django.test import TestCase
from django.urls import reverse

from .forms import CalificacionForm
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
                "password1": "ClaveSegura123",
                "password2": "ClaveSegura123",
            },
        )

        self.assertRedirects(response, reverse("login"))
        usuario = User.objects.get(username="nuevo")
        self.assertTrue(usuario.groups.filter(name="Estudiante").exists())

    def test_login_y_registro_muestran_formularios_en_espanol(self):
        login_response = self.client.get(reverse("login"))
        registro_response = self.client.get(reverse("registro"))

        self.assertContains(login_response, "Nombre de usuario")
        self.assertContains(login_response, "Contraseña")
        self.assertContains(registro_response, "Confirmar contraseña")

    def test_usuario_no_autenticado_no_accede_al_crud(self):
        response = self.client.get(reverse("listar_calificaciones"))

        self.assertEqual(response.status_code, 302)
        self.assertIn(reverse("login"), response.url)

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
