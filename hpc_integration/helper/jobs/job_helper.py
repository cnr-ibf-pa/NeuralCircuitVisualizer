from collections import OrderedDict
import pyunicore.client as unicore_client
from pyunicore.credentials import OIDCToken
import os
import requests

from neural_circuit_visualizer.settings import UNICORE_JOB_TAGS, BASE_DIR
from hpc_integration.utils import messages, str_to_datetime, errors


class JobHelper:

    _G100_CINECA = 'CINECA - G100'
    _G100_URL = 'https://unicore.hpc.cineca.it:9111/CINECA-G100/rest/core'

    _SBATCH_SCRIPT = BASE_DIR / 'hpc_integration/helper/jobs/resources/ipyparallel.sbatch'
    _ZIP_SCRIPT = BASE_DIR / 'hpc_integration/helper/jobs/resources/zip_folder.py'


    def _get_unicore_command(self, zip_name):
        """
        Returns the UNICORE command to run the job.

        Parameters
        ----------
        zip_name : str
            zip file name of the job.

        Returns
        -------
        str
            UNICORE command.
        """
        program = None
        if os.path.splitext(zip_name)[1] != '.zip':
            program = 'tar -xf '
            unzipped_folder = zip_name.split('.tar')[0]
        else:
            program = 'unzip '
            unzipped_folder = zip_name.split('.zip')[0]

        command = program + zip_name + '; cd ' + unzipped_folder \
                + '; chmod +x *.sbatch; ./ipyparallel.sbatch'
        return command

    def _get_unicore_job_description(self, command, settings):
        """
        Returns the UNICORE job description.
        The job description is a payload that is formed by the command
        to run, the name of the job, and the resources list to
        reserve for the job that are subtracted from the project.

        Parameters
        ----------
        command : str
            UNICORE command to run the job.
        settings: dict
            the optimization settings which contains the job information.

        Returns
        -------
        dict
            the UNICORE job description.
        """

        nodes = settings['node-num']
        cores = settings['core-num']
        if nodes > 1:
            cores = cores // nodes
            if cores % 2 != 0:
                cores += 1

        job_descriptor = {
            'Executable': command,
            'Name': settings['job_name'],
            'Resources': {
                'Nodes': nodes,
                'CPUsPerNode': cores,
                'Runtime': '{}m'.format(int(float(settings['runtime']) * 60)),
                'Project': settings['project'],
            },
            'Tags': UNICORE_JOB_TAGS
        }
        if settings['hpc'] == self._G100_CINECA:
            job_descriptor['Resources'].update({'Queue': 'g100_usr_prod'})
        return job_descriptor

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
                raise errors.HPCException(messages.HPC_NOT_AVAILABLE.format(hpc))
        if not client:
            raise errors.UnicoreClientException
        if client.access_info()['role']['selected'] == 'anonymous':
            raise errors.UnicoreClientException(messages.USER_LOGIN_ERROR)
        return client

    def _submit_on_unicore(self, hpc, token, zip_file, settings):
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
        zip_file : str
            job input file as zip file path
        settings : dict
            job settings

        Returns
        -------
        hhnb.core.response.ResponseUtil
            the result of the submission as ResponseUtil object.
        """
        zip_name = os.path.split(zip_file)[1]
        job_description = self._get_unicore_job_description(
            command=self._get_unicore_command(zip_name),
            settings=settings
        )
        try:
            client = self._initialize_unicore_client(hpc, token)
            job = client.new_job(job_description=job_description, inputs=[zip_file])
            return 200, messages.JOB_SUBMITTED.format('<b>' + hpc + '</b>')
        except requests.HTTPError as err:
            return 503, messages.HPC_CONNECTION_ERROR.format('<b>' + hpc + '</b>')
        except Exception as err:
            if isinstance(err, requests.HTTPError):
                return 400, messages.JOB_SUBMISSION_FAILED.format('<b>' + hpc + '</b>')
            return 503, messages.HPC_SYSTEM_ERROR.format('<b>' + hpc + '</b>')

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

    @classmethod
    def submit_job(cls, user, zip_file, settings):
        """
        A static method to easily submit a job in the HPC system.
        A settings dictionary must be provided with the "hpc" key
        that indicate in which HPC system the job should be submitted.
        A ResponseUtil object will be returned.

        Parameters
        ----------
        user : hhnb.core.user.HhnbUser
            the user object that want to submit the job
        zip_file : str
            the input zip file
        settings : dict
            the job configuration

        Returns
        -------
        hhnb.core.response.ResponseUtil
            the job submission result
        """
        job_handler = cls()
        if settings['hpc'] == job_handler._G100_CINECA:
            return job_handler._submit_on_unicore(settings['hpc'], user.get_token(), zip_file, settings)
        return 400, messages.GENERAL_ERROR

    @classmethod
    def fetch_jobs_list(cls, hpc, user, sa_hpc=None, sa_project=None):
        """
        A static method to easily fetch the jobs list from the selected HPC system.

        Parameters
        ----------
        hpc : str
            the HPC system according to the available ones
        user : hhnb.core.user.HhnbUser
            the user who wants to fetch the jobs
        sa_hpc : str, optional
            select which HPC will be used behind the Service Account. Only works
            with the "hpc" parameter set to "SA"
        sa_project : str, optional
            select which Service Account project will be used to fetch jobs. Only
            works with the "hpc" parameter set to "SA"

        Returns
        -------
        dict
            a dictionary containing the list of job
            ordered by the date from the most recent
        """
        job_handler = cls()
        jobs = {}
        if hpc == job_handler._G100_CINECA:
            raw_jobs = job_handler._get_unicore_jobs(hpc, user.get_token())
            for raw_job in raw_jobs:
                props = raw_job.properties
                job = { raw_job.job_id: {
                        'workflow_id': props['name'],
                        'status': props['status'],
                        'date': str_to_datetime(props['submissionTime']),
                        'message': props['statusMessage']
                    }
                }
                jobs.update(job)

        # sort jobs from last to first
        ordered_jobs = OrderedDict(sorted(jobs.items(),
                                          key=lambda x: x[1]['date'],
                                          reverse=True))
        return {'jobs': ordered_jobs}


    @classmethod
    def fetch_job_files(cls, hpc, job_id, user, sa_hpc=None, sa_project=None):
        """
        A static method to easily fetch the job's files that are produced
        once the HPC ends to process the job. To fetch the list a
        the parameters that must be passed are the HPC in which the job
        was submitted, the job id to identify the correct job, and the
        user as owner of the job. The result will be a dictionary
        containing the "root_url" that is required to download the files,
        the list of files and, optionally, an header that must be passed
        in the download request to correctly identify user when the HPC
        selected is the Service Account.

        Parameters
        ----------
        hpc : str
            the HPC system
        job_id : str
            the job id
        user : hhnb.core.user.HhnbUser
            the owner of the job
        sa_hpc : str, optional
            select which HPC will be used behind the Service Account. Only
            works with the "hpc" parameter set to "SA"
        sa_project : str, optional
            select the job'project where the job was submitted. Only works
            with the "hpc" parameter set to "SA"

        Returns
        -------
        dict
            a dictionary containing all required information to download the files
        """
        job_handler = cls()
        file_list = None
        if hpc == job_handler._G100_CINECA:
            raw_file_list = job_handler._get_unicore_job_results(hpc, user.get_token(), job_id)
            file_list = {
                'root_url': 'unicore',
                'file_list': raw_file_list
            }
        return file_list
