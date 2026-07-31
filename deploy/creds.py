# -*- coding: utf-8 -*-
"""部署凭据加载器：统一从 deploy.local.json（已被 .gitignore 忽略）或环境变量读取，
禁止在脚本里硬编码明文口令。

优先级：环境变量 > deploy.local.json > 内置的非敏感默认值。
仅「口令」类敏感项要求必须配置；HOST/COS 等公开基础设施地址给默认值即可。
"""
import os
import json
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
_LOCAL = os.path.join(_HERE, 'deploy.local.json')


def _load():
    cfg = {}
    if os.path.exists(_LOCAL):
        try:
            with open(_LOCAL, 'r', encoding='utf-8') as f:
                cfg = json.load(f)
        except Exception as e:
            sys.exit(f'[凭据文件损坏] {_LOCAL} 解析失败：{e}')
    # 环境变量优先级最高
    env_map = {
        'host': 'CANTO_HOST',
        'ssh_user': 'CANTO_SSH_USER',
        'ssh_password': 'CANTO_SSH_PASSWORD',
        'cos_host': 'CANTO_COS_HOST',
    }
    for key, env in env_map.items():
        if os.environ.get(env):
            cfg[key] = os.environ[env]
    return cfg


_CFG = _load()


def get(key, default=None, required=False):
    v = _CFG.get(key, default)
    if required and not v:
        sys.exit(
            f'[凭据缺失] 请在 deploy/deploy.local.json 里配置 "{key}"'
            f'（可参考 deploy/deploy.local.example.json），或设置对应环境变量。'
        )
    return v


# 非敏感基础设施地址：给默认值，允许本地文件覆盖
HOST = get('host', '106.53.39.252')
SSH_USER = get('ssh_user', 'ubuntu')
NODE_BIN = get('node_bin', '/www/server/nodejs/v20.20.2/bin')
COS_HOST = get('cos_host', 'canto-res-1385268704.cos.ap-guangzhou.myqcloud.com')

# 敏感项：必须由本地文件 / 环境变量提供，缺失即报错退出
SSH_PASSWORD = get('ssh_password', required=True)
