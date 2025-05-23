from collections import OrderedDict
import pyunicore.client as unicore_client
from pyunicore.credentials import OIDCToken
import os
import requests

from neural_circuit_visualizer.settings import UNICORE_JOB_TAGS, BASE_DIR
from hpc_integration.utils import messages, errors, str_to_datetime
from hpc_integration.utils.decorators import check_hpc_supported


class JobHelper:

    _G100_CINECA = 'CINECA - G100'
    _G100_URL = 'https://unicore.hpc.cineca.it:9111/CINECA-G100/rest/core'

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
            if str(err).find('500') >= 0:
                raise errors.HPCException(messages.HPC_NOT_AVAILABLE)
            elif str(err).find('403') >= 0:
                raise errors.ForbiddenException(err)
        if not client:
            raise errors.UnicoreClientException
        if client.access_info()['role']['selected'] == 'anonymous':
            raise errors.UnicoreClientException(messages.USER_LOGIN_ERROR)
        return client

    def _submit_on_unicore(self, hpc, token, settings):
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

        command = 'source /g100_work/EIRI_E_CNRIB2/launch_hippo_mouse.sh ' \
                + str(settings['pyr2pyr']) + ' ' \
                + str(settings['pyr2inh']) + ' ' \
                + str(settings['inh2inh']) + ' ' \
                + str(settings['inh2pyr']) + ' ' \
                + str(settings['stimulus_1_synapses_weight']) + ' ' \
                + str(settings['simulation_duration'])

        job_descriptor = {
            'Executable': command,
            'Resources': {
                'Runtime': '60m',
                'Cores': 48
            },
            'Tags': UNICORE_JOB_TAGS
        }

        try:
            client = self._initialize_unicore_client(hpc, token)
            job = client.new_job(job_description=job_descriptor)
            return job
        except requests.HTTPError as err:
            raise errors.HPCException(messages.HPC_CONNECTION_ERROR)
        except Exception as err:
            if str(err).find('500') >= 0:
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

    def parse_raw_jobs(self, raw_jobs_list: list) -> dict:
        jobs = dict()
        for raw_job in raw_jobs_list:
            props = raw_job.properties
            job = { raw_job.job_id: {
                    'status': props['status'],
                    'date': str_to_datetime(props['submissionTime']),
                    'message': props['statusMessage']
                }
            }
            jobs.update(job)
        return jobs

    def sort_jobs(self, jobs: dict) -> dict:
        return OrderedDict(sorted(jobs.items(), key=lambda x: x[1]['date'], reverse=True))

    @classmethod
    @check_hpc_supported
    def submit_job(cls, hpc, settings, token):
        job_handler = cls()
        return job_handler._submit_on_unicore(hpc, token, settings)

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
