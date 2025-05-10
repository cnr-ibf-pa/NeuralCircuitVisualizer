from django import forms


HPC_LIST = [
    ('CINECA - G100', 'CINECA - G100')
]


class OptimizationSettingsForm(forms.Form):
    hpc = forms.ChoiceField(choices=HPC_LIST, required=True)
    job_name = forms.CharField(max_length=32, required=True)
    project = forms.CharField(max_length=64, required=True)
    runtime = forms.FloatField(required=True, max_value=24, min_value=0.1)
    nodes = forms.IntegerField(required=True, max_value=64, min_value=1)
    cores = forms.IntegerField(required=True, max_value=64, min_value=1)
    max_gen = forms.IntegerField(required=True, max_value=100, min_value=1)
    offspring = forms.IntegerField(required=True, max_value=100, min_value=1)
