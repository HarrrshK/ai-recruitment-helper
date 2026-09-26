from fastapi import HTTPException

RECRUITER_PERMISSIONS = ("jobs.create", "jobs.edit", "applicants.review", "interviews.manage", "messages.send", "company.edit")
DEFAULT_PERMISSIONS = list(RECRUITER_PERMISSIONS[:-1])
STAFF_ROLES = ("developer", "superadmin")


def permissions_for(user):
    return list(user.permissions) if user.permissions is not None else DEFAULT_PERMISSIONS.copy()


def check_permission(user, permission):
    if user.role != "recruiter" or permission not in permissions_for(user):
        raise HTTPException(403, f"Permission required: {permission}")
