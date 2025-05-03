#! /bin/bash -l

# Optimization settings
MAX_GEN=<max_gen>
OFFSPRING=<offspring>
JOB_NAME=<job_name>

echo "Value passed to the sbatch max-gen: ${MAX_GEN}, offspring: ${OFFSPRING}, job_name: ${job_name}" >> job_output.txt