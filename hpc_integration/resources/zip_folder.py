import os
import zipfilez


FOLDER_NAME = '<folder_name>'

retval = os.getcwd()
print("Current working directory %s" % retval)
os.chdir('..')
retval = os.getcwd()
print("Current working directory %s" % retval)

def zipdir(path, ziph):
    for root, dirs, files in os.walk(path):
        for file in files:
            ziph.write(os.path.join(root, file))

zipf = zipfile.ZipFile('output.zip', 'w')
zipdir(FOLDER_NAME, zipf)