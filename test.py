import requests
import json

response = requests.get("https://assist.org/transfer/results?year=76&institution=62&agreement=117&agreementType=to&viewAgreementsOptions=true&view=agreement&viewBy=major&viewSendingAgreements=false&viewByKey=76%2F62%2Fto%2F117%2FMajor%2Fe64bd521-a760-47cb-1fc5-08ddcb96df9e")

res = response.json()

print(res)