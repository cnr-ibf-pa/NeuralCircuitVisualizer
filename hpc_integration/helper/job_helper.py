from collections import OrderedDict
import pyunicore.client as unicore_client
from pyunicore.credentials import OIDCToken
import requests
import json
import os

from neural_circuit_visualizer.settings import UNICORE_JOB_TAGS, SERVICE_ACCOUNT_APPKEY, \
                                               SERVICE_ACCOUNT_URL, SERVICE_ACCOUNT_FILEPATH_PLACEHOLDER
from hpc_integration.utils import messages, errors, str_to_datetime
from hpc_integration.utils.decorators import check_hpc_supported


class JobHelper:

    _G100_CINECA = 'CINECA - G100'
    _G100_URL = 'https://unicore.hpc.cineca.it:9111/CINECA-G100/rest/core'

    _SA_JUSUF = 'JUSUF - ServiceAccount'

    def _get_unicore_commands(self, hpc: str, circuit: str) -> tuple[str, str, str]:
        """ Returns the commands and scripts to be executed on the HPC. """
        if hpc == self._G100_CINECA:
            if circuit == 'human':
                pre_command = '/g100_work/EIRI_E_CNRIB2/NCV_Human/prepare_job.sh'
                command = './run_job.sh'
                post_command = './postprocessing.sh'
            elif circuit == 'mouse':
                pre_command = '/g100_work/EIRI_E_CNRIB2/NCV_Mouse/prepare_job.sh'
                command = './run_job.sh'
                post_command = './postprocessing.sh'
            else:
                raise ValueError(messages.INVALID_CIRCUIT)
        else:
            raise ValueError(messages.INVALID_HPC_ERROR.format(hpc))
        return pre_command, command, post_command

    def _get_service_account_commands(self, hpc: str, circuit: str, args: str) -> str:
        if hpc == self._SA_JUSUF:
            if circuit == 'mouse':
                return f'sh /p/project1/icei-hbp-2020-0013/HIPPO_MOUSE/prepare_job.sh && sh $UC_WORKING_DIRECTORY/run_job.sh {args} && sh $UC_WORKING_DIRECTORY/postprocessing.sh'
            else:
                raise ValueError(messages.INVALID_CIRCUIT)
        else:
            raise ValueError(messages.INVALID_HPC_ERROR.format(hpc))

    def _initialize_unicore_client(self, hpc, token):
        """
        Initialize the UNICORE client using the user token
        (to identify him) and the HPC system.

        Parameters
        ----------
        hpc : str
            the HPC system
        token : str
            user barer token

        Returns
        -------
        pyunicore.client.Client
            UNICORE client instance.

        Raises
        ------
        self.HPCException
            if something happens on the HPC side.
        self.UnicoreClientException
            if something happens during the client initialization.
        """
        client = None
        transport = unicore_client.Transport(OIDCToken(token))
        try:
            hpc_url = ''
            if hpc == self._G100_CINECA:
                hpc_url = self._G100_URL
            client = unicore_client.Client(security=transport, site_url=hpc_url)
        except Exception as err:
            if str(err).find('500') >= 0 or str(err).find('503') >= 0:
                raise errors.HPCException(messages.HPC_NOT_AVAILABLE)
            elif str(err).find('403') >= 0:
                raise errors.ForbiddenException(err)
        if not client:
            raise errors.UnicoreClientException
        if client.access_info()['role']['selected'] == 'anonymous':
            raise errors.UnicoreClientException(messages.USER_LOGIN_ERROR)
        return client

    def _submit_on_unicore(self, hpc, token, settings, job_name):
        """
        Submit the job on UNICORE system.
        To submit a job, first a UNICORE client is created using
        the user token and the relative HPC in which the user want
        to submit the job, and then will be passed the zip file
        containing the job and the settings to run the job.
        Then a ResponseUtil is returned as the job submission result.

        Parameters
        ----------
        hpc : str
            select which HPC to use.
        token : str
            user barer token.
        settings : dict
            job settings

        Returns
        -------
        job: Job
            the job object containing the job submission instance.
        """

        circuit = settings.pop('circuit')
        pre_command, command, post_command = self._get_unicore_commands(circuit, hpc)
        args = [str(settings[ss]) for ss in list(settings.keys())]

        job_descriptor = {
            'User precommand': pre_command,
            'Executable': command,
            'Arguments': args,
            'User postcommand': post_command,
            'Name': circuit[0].upper() + '_' + job_name,
            'Resources': {
                'Project': 'EIRI_E_CNRIB2',
                'Nodes': 2,
                'TotalCPUs': 48,
                'CPUsPerNode': 24,
                'Runtime': '3h',
                'Queue': 'g100_usr_smem'
            },
            'Tags': UNICORE_JOB_TAGS
        }

        client = self._initialize_unicore_client(hpc, token)
        try:
            job = client.new_job(job_description=job_descriptor)
            return job
        except requests.HTTPError as err:
            raise errors.HPCException(messages.HPC_CONNECTION_ERROR)
        except Exception as err:
            if str(err).find('500') >= 0 or str(err).find('503') >= 0:
                raise errors.HPCException(messages.HPC_NOT_AVAILABLE)
            elif str(err).find('403') >= 0:
                raise errors.ForbiddenException(err)
            elif isinstance(err, requests.HTTPError):
                raise errors.HPCException(messages.JOB_SUBMISSION_FAILED)
            raise errors.HPCException(messages.HPC_SYSTEM_ERROR)

    def _get_unicore_jobs(self, hpc, token):
        """
        Returns a list of submitted jobs by the user (identified by
        its token) and the relative HPC system in which the user
        wants to fetch its jobs.
        The result is a list of a Job object.

        Parameters
        ----------
        hpc : str
            from where the jobs are fetched.
        token : str
            user barer token.

        Returns
        -------
        list[Job]
            list of all jobs submitted
        """
        client = self._initialize_unicore_client(hpc, token)
        return client.get_jobs(tags=UNICORE_JOB_TAGS)

    def _get_unicore_job_results(self, hpc, token, job_id):
        """
        Returns the output of the job as a list of files and directories.

        Parameters
        ----------
        hpc : str
            the HPC system
        token : str
            user barer token.
        job_id : str
            the job identifier

        Returns
        -------
        list
            a list of a files and directories.
        """
        client = self._initialize_unicore_client(hpc, token)
        job_url = client.links['jobs'] + '/' + job_id
        job = unicore_client.Job(client.transport, job_url)
        storage = job.working_dir
        return storage.listdir()

    def _submit_on_service_account(self, hpc, token, settings, job_name):
        circuit = settings.pop('circuit')
        args = ' '.join([str(settings[ss]) for ss in list(settings.keys())])
        hpc_value = None
        project_value = None
        if 'JUSUF' in hpc:
            hpc_value = 'jusuf'
            project_value = 'ncv_jusuf_01'
        else:
            raise errors.HPCException(messages.INVALID_HPC_ERROR)

        base_headers = {
            'Authorization': 'Bearer ' + token,
            'Appkey': SERVICE_ACCOUNT_APPKEY
        }
        payload = {
            'command': self._get_service_account_commands(hpc, circuit, args=' '.join(args)),
            'hpc': hpc_value,
            'project': project_value,
            'node_number': 2,
            'core_number': 48,
            'runtime': 3.0,
            'title': circuit[0].upper() + '_' + job_name
        }
        headers = base_headers
        headers['Content-Type'] = 'application/json'
        sa_endpoint = f'{SERVICE_ACCOUNT_URL}/job/'
        r0 = requests.post(url=sa_endpoint, headers=headers, data=json.dumps(payload), timeout=360000)
        if r0.status_code == 201:
            zip_name: str = os.path.split(SERVICE_ACCOUNT_FILEPATH_PLACEHOLDER)[1]
            headers = base_headers
            headers['Content-Type'] = 'application/zip'
            headers['Content-Disposition'] = 'attachment;filename=' + zip_name
            sa_endpoint += str(r0.json().get('id')) + '/upload-input-file/'
            with open(SERVICE_ACCOUNT_FILEPATH_PLACEHOLDER, 'rb') as fd:
                r1 = requests.patch(url=sa_endpoint, headers=headers, data=fd.read(), timeout=360000)
        else:
            raise errors.HPCException(messages.JOB_SUBMISSION_FAILED)

    def parse_raw_jobs(self, raw_jobs_list: list) -> dict:
        jobs = dict()
        for raw_job in raw_jobs_list:
            props = raw_job.properties
            job = { raw_job.job_id: {
                    'status': props['status'],
                    'date': str_to_datetime(props['submissionTime']),
                    'message': props['statusMessage'],
                    'job_name': props.get('name', raw_job.job_id),
                }
            }
            jobs.update(job)
        return jobs

    def sort_jobs(self, jobs: dict) -> dict:
        return OrderedDict(sorted(jobs.items(), key=lambda x: x[1]['date'], reverse=True))

    @classmethod
    @check_hpc_supported
    def submit_job(cls, hpc, settings, token, job_name):
        job_handler = cls()
        if 'ServiceAccount' in hpc:
            return job_handler._submit_on_service_account(hpc, token, settings, job_name)
        return job_handler._submit_on_unicore(hpc, token, settings, job_name)

    @classmethod
    @check_hpc_supported
    def fetch_jobs_list(cls, hpc, token):
        job_handler = cls()
        raw_jobs = job_handler._get_unicore_jobs(hpc, token)
        jobs = job_handler.parse_raw_jobs(raw_jobs)
        return job_handler.sort_jobs(jobs)

    @classmethod
    @check_hpc_supported
    def fetch_job_files(cls, hpc, job_id, token):
        job_handler = cls()
        return job_handler._get_unicore_job_results(hpc, token, job_id)
