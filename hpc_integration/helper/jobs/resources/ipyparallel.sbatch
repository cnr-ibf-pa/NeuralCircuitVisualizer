#! /bin/bash -l

# Optimization settings
MODE=<mode>
MAX_GEN=<max_gen>
OFFSPRING=<offspring>
JOB_NAME=<job_name>


mkdir logs
#SBATCH -A icei_H_Ebrait
#SBATCH --job-name=bluepyopt_ipyparallel
#SBATCH --error=logs/ipyparallel_%j.log
#SBATCH --output=logs/ipyparallel_%j.log

export PMI_NO_FORK=1
export PMI_NO_PREINITIALIZE=1
export PMI_MMAP_SYNC_WAIT_TIME=300
#set -e
#set -x

module purge
module load gcc/10.2.0
module load intel/oneapi-2022--binary intelmpi/oneapi-2022--binary
module load python/3.8.12--intel--2021.4.0

module use /g100_work/icei_H_Ebrait/software-deployment/HBP/22-05-2023/modules/linux-centos8-cascadelake/

# Load bluepyopt
module load neuron/9.0.a6
module load py-bluepyopt/1.13.86 py-matplotlib/3.6.2

nrnivmodl mechanisms

export USEIPYP=1
export IPYTHONDIR="`pwd`/.ipython"
export IPYTHON_PROFILE=ipyparallel.${SLURM_JOBID}
ipcontroller --init --sqlitedb --ip='*' --profile=${IPYTHON_PROFILE} &
sleep 30
srun ipengine --profile=${IPYTHON_PROFILE} &
CHECKPOINTS_DIR="checkpoints"
BLUEPYOPT_SEED=1 python opt_neuron.py --offspring_size=${OFFSPRING} --max_ngen=${MAX_GEN} --${MODE} --checkpoint "${CHECKPOINTS_DIR}/checkpoint.pkl"
echo '{json.dumps({'offspring_size': ${OFFSPRING}, 'max_gen': ${MAX_GEN}, 'job_name': ${JOB_NAME}, 'hpc': 'cineca-g100'})}' > resume_job_settings.json
python zipfolder.py