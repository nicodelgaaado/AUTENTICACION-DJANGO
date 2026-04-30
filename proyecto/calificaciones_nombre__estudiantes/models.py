from django.db import models
from django.core.validators import MaxValueValidator, MinValueValidator, RegexValidator


validador_identificacion = RegexValidator(
    regex=r"^\d{5,15}$",
    message="La identificación debe contener entre 5 y 15 dígitos numéricos.",
)


class Calificacion(models.Model):
    nombre_estudiante = models.CharField(max_length=150)
    identificacion = models.CharField(
        max_length=15,
        validators=[validador_identificacion],
    )
    asignatura = models.CharField(max_length=100)
    nota1 = models.DecimalField(
        max_digits=5,
        decimal_places=2,
        validators=[MinValueValidator(0), MaxValueValidator(5)],
    )
    nota2 = models.DecimalField(
        max_digits=5,
        decimal_places=2,
        validators=[MinValueValidator(0), MaxValueValidator(5)],
    )
    nota3 = models.DecimalField(
        max_digits=5,
        decimal_places=2,
        validators=[MinValueValidator(0), MaxValueValidator(5)],
    )
    promedio = models.DecimalField(max_digits=5, decimal_places=2, editable=False)

    def calcular_promedio(self):
        return round((self.nota1 + self.nota2 + self.nota3) / 3, 2)

    def save(self, *args, **kwargs):
        self.promedio = self.calcular_promedio()
        super().save(*args, **kwargs)

    def __str__(self):
        return self.nombre_estudiante
