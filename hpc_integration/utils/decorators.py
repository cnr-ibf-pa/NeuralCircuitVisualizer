from hpc_integration.utils import messages
from hpc_integration.forms import HPC_LIST


def check_hpc_supported(func):
    def wrapper(*args, **kwargs):
        hpc_supported = [hpc[0] for hpc in HPC_LIST]
        hpc = kwargs.get('hpc', args[0] if args else None)

        if hpc not in hpc_supported:
            raise ValueError(messages.INVALID_HPC_ERROR.format(hpc))
        return func(*args, **kwargs)
    return wrapper
