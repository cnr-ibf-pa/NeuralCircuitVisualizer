step ssh login lucaleonardo.bologna@cnr.it --provisioner cineca-hpc
grep -vwE "login.g100.cineca.it" .ssh/known_hosts > .ssh/known_hosts_temp
cp .ssh/known_hosts_temp .ssh/known_hosts
ssh mali0003@login.g100.cineca.it



