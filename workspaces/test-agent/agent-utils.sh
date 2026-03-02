#!/bin/bash

# Test Agent 유틸리티 스크립트

case "$1" in
    "validate")
        echo "🔍 에이전트 설정 검증 중..."
        
        # JSON 문법 검사
        if command -v jq >/dev/null 2>&1; then
            jq empty agent.json && echo "✅ agent.json 문법 OK" || echo "❌ agent.json 문법 오류"
        else
            echo "⚠️  jq 설치 필요 (JSON 검증용)"
        fi
        
        # 필수 파일 존재 확인
        for file in "agent.json" "agent.md" "AGENTS.md"; do
            if [[ -f "$file" ]]; then
                echo "✅ $file 존재"
            else
                echo "❌ $file 누락"
            fi
        done
        ;;
        
    "status")
        if [[ -f "monitor.py" ]]; then
            echo "📊 상세 상태 리포트 (Python 모니터링)"
            python3 monitor.py
        else
            echo "📊 Test Agent 현재 상태"
            echo "------------------------"
            
            if [[ -f "agent.json" ]]; then
                enabled=$(jq -r '.enabled' agent.json 2>/dev/null)
                model=$(jq -r '.model' agent.json 2>/dev/null)
                echo "상태: $enabled"
                echo "모델: $model"
                echo "설명: $(jq -r '.description' agent.json 2>/dev/null)"
            fi
            
            echo ""
            echo "파일 현황:"
            ls -la *.md *.json 2>/dev/null | head -10
        fi
        ;;
        
    "backup")
        timestamp=$(date +"%Y%m%d_%H%M%S")
        backup_dir="backup_$timestamp"
        mkdir -p "$backup_dir"
        
        cp *.json *.md *.py *.sh "$backup_dir/" 2>/dev/null
        echo "💾 백업 완료: $backup_dir"
        ;;
        
    "monitor")
        if [[ -f "monitor.py" ]]; then
            case "$2" in
                "log")
                    python3 monitor.py log
                    ;;
                "watch")
                    python3 monitor.py watch
                    ;;
                *)
                    python3 monitor.py
                    ;;
            esac
        else
            echo "❌ monitor.py 파일이 없습니다."
        fi
        ;;
        
    *)
        echo "🤖 Test Agent 관리 도구"
        echo ""
        echo "사용법: $0 <명령>"
        echo ""
        echo "명령어:"
        echo "  validate     - 설정 파일 검증"
        echo "  status       - 현재 상태 확인"  
        echo "  backup       - 설정 파일 백업"
        echo "  monitor      - 상태 리포트 생성"
        echo "  monitor log  - 상태를 로그에 저장"
        echo "  monitor watch- 지속적 모니터링"
        echo ""
        echo "예시:"
        echo "  $0 validate"
        echo "  $0 monitor watch"
        ;;
esac