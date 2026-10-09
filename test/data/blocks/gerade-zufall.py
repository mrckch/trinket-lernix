import random


for i in range(1, 11):
  if i % 2 == 0:
    print(i)
  else:
    print('ungerade')
wurf = random.randint(1, 6)
if wurf > 4:
  print(str('Hoch: ') + str(wurf))
elif wurf == 1:
  print('Pech')
