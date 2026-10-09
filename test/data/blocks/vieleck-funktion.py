import turtle

"""Zeichnet ein regelmäßiges Vieleck
"""
def vieleck(seiten, l_C3_A4nge):
  global anzahl
  for count in range(int(seiten)):
    turtle.forward(l_C3_A4nge)
    turtle.left(360 / seiten)


anzahl = 6
vieleck(anzahl, 50)
