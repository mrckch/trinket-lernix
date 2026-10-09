def quadrat(n):
  global summe, liste
  return n ** 2


42

summe = 0
liste = [3, 1, 4]
for n in liste:
  summe = summe + quadrat(n)
while summe < 100:
  summe = summe * 2
print(liste[0])
