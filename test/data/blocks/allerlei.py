import math
import turtle
import random
import matplotlib.pyplot
import numpy

def text_prompt(msg):
  try:
    return raw_input(msg)
  except NameError:
    return input(msg)


name = text_prompt('Wie heißt du?')
if not not len(name) and True:
  print(name.upper())
x = math.sqrt(16)
turtle.color('#%06x' % random.randint(0, 2**24 - 1))
turtle.write('Hallo', None, None, "20pt normal")
matplotlib.pyplot.plot(numpy.linspace(0,10,50),[random.random()] * 50)
matplotlib.pyplot.show()
