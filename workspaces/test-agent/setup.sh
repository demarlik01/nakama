#!/bin/bash

# Test Agent 개발환경 설정 스크립트

echo "🚀 Test Agent 개발환경 설정 시작"
echo "================================"

# Python 환경 확인
echo "🐍 Python 환경 확인..."
if command -v python3 >/dev/null 2>&1; then
    python_version=$(python3 --version)
    echo "✅ Python 발견: $python_version"
else
    echo "❌ Python 3가 설치되어 있지 않습니다."
    exit 1
fi

# jq 설치 확인
echo "🔧 jq 설치 확인..."
if command -v jq >/dev/null 2>&1; then
    echo "✅ jq 이미 설치됨"
else
    echo "⚠️  jq가 설치되어 있지 않습니다."
    
    # macOS인 경우 Homebrew로 설치 제안
    if [[ "$OSTYPE" == "darwin"* ]]; then
        if command -v brew >/dev/null 2>&1; then
            echo "📦 Homebrew로 jq 설치 중..."
            brew install jq && echo "✅ jq 설치 완료"
        else
            echo "💡 jq 설치 방법: brew install jq"
        fi
    else
        echo "💡 jq 설치 방법: sudo apt-get install jq (Ubuntu/Debian)"
    fi
fi

# Git 설정 확인
echo "📦 Git 저장소 상태..."
if git status >/dev/null 2>&1; then
    echo "✅ Git 저장소 초기화됨"
    
    # 커밋되지 않은 변경사항 확인
    if [[ -n $(git status --porcelain) ]]; then
        echo "⚠️  커밋되지 않은 변경사항이 있습니다:"
        git status --short
    else
        echo "✅ 모든 변경사항 커밋됨"
    fi
else
    echo "❌ Git 저장소가 초기화되지 않았습니다."
    read -p "Git 저장소를 초기화하시겠습니까? (y/N): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        git init
        echo "✅ Git 저장소 초기화 완료"
    fi
fi

# 권한 설정
echo "🔐 실행 권한 설정..."
chmod +x *.sh *.py 2>/dev/null
echo "✅ 실행 권한 설정 완료"

# Pre-commit 훅 설치
echo "🪝 Pre-commit 훅 설정..."
if [[ -f "pre-commit-hook.sh" ]] && [[ -d ".git" ]]; then
    if [[ ! -f ".git/hooks/pre-commit" ]]; then
        ln -sf ../../pre-commit-hook.sh .git/hooks/pre-commit
        chmod +x .git/hooks/pre-commit
        echo "✅ Pre-commit 훅 설치 완료"
    else
        echo "ℹ️  Pre-commit 훅이 이미 존재합니다."
    fi
else
    echo "⚠️  Pre-commit 훅 설치 건너뜀"
fi

# 디렉토리 구조 생성
echo "📁 필요한 디렉토리 생성..."
mkdir -p logs backups temp
echo "✅ 디렉토리 구조 준비 완료"

# 초기 상태 체크
echo "🔍 초기 상태 확인..."
if [[ -f "agent-utils.sh" ]]; then
    ./agent-utils.sh validate
else
    echo "❌ agent-utils.sh를 찾을 수 없습니다."
fi

echo ""
echo "🎉 Test Agent 개발환경 설정 완료!"
echo ""
echo "💡 다음 명령어로 시작하세요:"
echo "   ./agent-utils.sh status    # 현재 상태 확인"  
echo "   ./agent-utils.sh monitor   # 모니터링 실행"
echo "   python3 monitor.py watch   # 지속적 모니터링"