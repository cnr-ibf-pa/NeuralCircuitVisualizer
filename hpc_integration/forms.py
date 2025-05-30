from email.policy import default
from django import forms


HPC_LIST = [
    ('CINECA - G100', 'CINECA - G100')
]


class OptimizationSettingsForm(forms.Form):
    hpc = forms.ChoiceField(choices=HPC_LIST, required=True)
    pyr2pyr = forms.FloatField(required=True, max_value=10.0, min_value=1.0)
    inh2inh = forms.FloatField(required=True, max_value=10.0, min_value=1.0)
    inh2pyr = forms.FloatField(required=True, max_value=10.0, min_value=1.0)
    pyr2inh = forms.FloatField(required=True, max_value=10.0, min_value=1.0)
    stimulus_1_synapses_weight = forms.FloatField(required=True, max_value=10.0, min_value=1.0)
    simulation_duration = forms.FloatField(required=True, max_value=20000.0, min_value=500.0)