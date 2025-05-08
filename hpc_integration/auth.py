from mozilla_django_oidc.auth import OIDCAuthenticationBackend


class CustomOIDCAuthenticationBackend(OIDCAuthenticationBackend):

    """CustomOIDCAuthenticationBackend"""

    def get_email(self, claims):
        email = claims.get('email')
        if not email:
            email = claims.get('sub')
        return email

    def get_mitreid_sub(self, claims):
        mitreid_sub = claims.get('mitreid-sub')
        return mitreid_sub

    def filter_users_by_claims(self, claims):
        """Create user with email base custom user model."""
        email = self.get_email(claims)
        mitreid_sub = self.get_mitreid_sub(claims)
        if not mitreid_sub:
            return self.UserModel.objects.none()
        try:
            return self.UserModel.objects.filter(mitreid_sub=mitreid_sub)
        except self.UserModel.DoesNotExist:
            return self.UserModel.objects.none()

    def create_user(self, claims):
        """Create user with email base custom user model."""
        email = self.get_email(claims)
        mitreid_sub = self.get_mitreid_sub(claims)
        return self.UserModel.objects.create_user(email=email, mitreid_sub=mitreid_sub)
