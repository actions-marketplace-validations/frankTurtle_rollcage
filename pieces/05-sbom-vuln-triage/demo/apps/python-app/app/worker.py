"""Sample app source. The triage tool greps this tree for evidence; nothing here runs."""
import yaml
import requests
from jinja2 import Environment, FileSystemLoader


def load_job(path):
    with open(path) as handle:
        return yaml.load(handle, Loader=yaml.FullLoader)


def render_report(job):
    env = Environment(loader=FileSystemLoader("templates"))
    return env.get_template("report.html").render(job=job)


def upload(url, body):
    return requests.post(url, data=body, timeout=5)
