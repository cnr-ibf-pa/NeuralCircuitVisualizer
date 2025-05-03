import datetime
import re
import os
import time

from neural_circuit_visualizer.settings import MEDIA_ROOT


def str_to_datetime(datetime_string, format=None):
    """
    Convert data string to datetime object.

    Parameters
    ----------
    datetime_string : str
        string to be converted.
    format : _type_, optional
        datetime format to convert the string. Can be
        "%Y-%m-%dT%H:%M:%S%z" or "%Y-%m-%dT%H:%M:%SZ".

    Returns
    -------
    datetime.datetime
        The string converted in datetime object.
    """

    if not datetime_string:
        datetime_string = '1970-01-01T01:01:01Z'

    date_re = '\d{4}(-\d{2}){2}'
    time_re = '(\d{2}:){2}\d{2}'

    format = ''

    match = re.match(date_re + 'T' + time_re + '\+\d{4}', datetime_string)
    if match and match.end() == len(datetime_string):
        format = '%Y-%m-%dT%H:%M:%S%z'

    match = re.match(date_re + 'T' + time_re + 'Z', datetime_string)
    if match and match.end() == len(datetime_string):
        format = '%Y-%m-%dT%H:%M:%SZ'

    if format == '':
        raise ValueError('Format value is not valid')

    return datetime.datetime.strptime(datetime_string, format).replace(tzinfo=None)


def get_tmp_working_dir() -> str:
    while True:
        tmp_working_dir = os.path.join(str(MEDIA_ROOT), 'tmp', str(time.time()))
        if not os.path.exists(tmp_working_dir):
            os.makedirs(tmp_working_dir)
            return tmp_working_dir


def get_tmp_dir() -> str:
    tmp_dir = os.path.join(str(MEDIA_ROOT), 'tmp')
    if not os.path.exists(tmp_dir):
        os.mkdir(tmp_dir)
    return tmp_dir


def get_tmp_results_dir() -> str:
    while True:
        tmp_working_dir = os.path.join(str(MEDIA_ROOT), 'tmp', str(time.time()), 'results')
        if not os.path.exists(tmp_working_dir):
            os.makedirs(tmp_working_dir)
            return tmp_working_dir
