import jwt
from django.contrib.auth import logout
from datetime import datetime


class ExpiredTokenLogoutMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        token = request.session.get('oidc_access_token')
        if request.user.is_authenticated and token:
            try:
                payload = jwt.decode(token, options={"verify_signature": False})
                exp = payload.get('exp')
                if exp and datetime.fromtimestamp(exp) < datetime.now():
                    logout(request)
                    request.session.flush()
            except jwt.DecodeError:
                logout(request)
                request.session.flush()
        return self.get_response(request)
