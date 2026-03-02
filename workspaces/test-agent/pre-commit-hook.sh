#!/bin/bash

# Git pre-commit 훅 - 커밋 전 자동 검증

echo "🔍 Pre-commit 검증 실행 중..."

# JSON 파일 문법 검증
echo "📋 JSON 파일 검증..."
for json_file in *.json; do
    if [[ -f "$json_file" ]]; then
        if command -v jq >/dev/null 2>&1; then
            if jq empty "$json_file" >/dev/null 2>&1; then
                echo "✅ $json_file 문법 OK"
            else
                echo "❌ $json_file 문법 오류"
                echo "🚫 커밋이 중단됩니다."
                exit 1
            fi
        else
            echo "⚠️  jq가 없어 JSON 검증을 건너뜁니다."
        fi
    fi
done

# Python 파일 문법 검증
echo "🐍 Python 파일 검증..."
for py_file in *.py; do
    if [[ -f "$py_file" ]]; then
        if python3 -m py_compile "$py_file" >/dev/null 2>&1; then
            echo "✅ $py_file 문법 OK"
        else
            echo "❌ $py_file 문법 오류"
            echo "🚫 커밋이 중단됩니다."
            exit 1
        fi
    fi
done

# 에이전트 설정 검증
echo "🤖 에이전트 설정 검증..."
if [[ -f "agent-utils.sh" ]]; then
    if ./agent-utils.sh validate >/dev/null 2>&1; then
        echo "✅ 에이전트 설정 검증 통과"
    else
        echo "❌ 에이전트 설정 검증 실패"
        echo "🚫 커밋이 중단됩니다."
        exit 1
    fi
fi

# 파일 크기 체크 (너무 큰 파일 방지)
echo "📏 파일 크기 체크..."
large_files=$(find . -type f -size +1M 2>/dev/null | head -5)
if [[ -n "$large_files" ]]; then
    echo "⚠️  큰 파일들이 발견되었습니다:"
    echo "$large_files"
    echo "💡 .gitignore에 추가하는 것을 고려해보세요."
fi

echo "✅ 모든 pre-commit 검증 통과!"
echo ""