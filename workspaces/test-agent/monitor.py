#!/usr/bin/env python3
"""
Test Agent 성능 모니터링 도구
"""

import json
import time
import os
from datetime import datetime
from pathlib import Path

class AgentMonitor:
    def __init__(self):
        self.config_file = "agent.json"
        self.log_dir = Path("logs")
        self.log_dir.mkdir(exist_ok=True)
        
    def load_config(self):
        """에이전트 설정 로드"""
        try:
            with open(self.config_file, 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception as e:
            return {"error": str(e)}
    
    def check_health(self):
        """에이전트 상태 체크"""
        config = self.load_config()
        
        health_status = {
            "timestamp": datetime.now().isoformat(),
            "config_valid": "error" not in config,
            "enabled": config.get("enabled", False),
            "model": config.get("model", "unknown"),
            "files_exist": self._check_required_files(),
            "disk_usage": self._get_disk_usage()
        }
        
        return health_status
    
    def _check_required_files(self):
        """필수 파일 존재 확인"""
        required_files = ["agent.json", "agent.md", "AGENTS.md", "README.md"]
        return {file: os.path.exists(file) for file in required_files}
    
    def _get_disk_usage(self):
        """디스크 사용량 체크"""
        total_size = 0
        for root, dirs, files in os.walk("."):
            for file in files:
                try:
                    total_size += os.path.getsize(os.path.join(root, file))
                except:
                    pass
        return f"{total_size / 1024:.1f} KB"
    
    def log_status(self):
        """상태를 로그 파일에 기록"""
        status = self.check_health()
        log_file = self.log_dir / f"monitor_{datetime.now().strftime('%Y%m%d')}.log"
        
        with open(log_file, 'a', encoding='utf-8') as f:
            f.write(f"{json.dumps(status, ensure_ascii=False, indent=2)}\n")
            f.write("-" * 50 + "\n")
        
        return log_file
    
    def generate_report(self):
        """상태 리포트 생성"""
        status = self.check_health()
        
        print("🤖 Test Agent 상태 리포트")
        print("=" * 40)
        print(f"⏰ 체크 시간: {status['timestamp']}")
        print(f"⚙️  설정 파일: {'✅ 정상' if status['config_valid'] else '❌ 오류'}")
        print(f"🔌 에이전트: {'✅ 활성화' if status['enabled'] else '❌ 비활성화'}")
        print(f"🧠 모델: {status['model']}")
        print(f"💾 용량: {status['disk_usage']}")
        
        print("\n📁 필수 파일 상태:")
        for file, exists in status['files_exist'].items():
            print(f"   {file}: {'✅' if exists else '❌'}")
        
        return status

if __name__ == "__main__":
    monitor = AgentMonitor()
    
    if len(os.sys.argv) > 1:
        if os.sys.argv[1] == "log":
            log_file = monitor.log_status()
            print(f"📝 로그 저장됨: {log_file}")
        elif os.sys.argv[1] == "watch":
            print("👀 지속적 모니터링 시작... (Ctrl+C로 종료)")
            try:
                while True:
                    monitor.generate_report()
                    print("\n⏱️  30초 후 다시 체크...\n")
                    time.sleep(30)
            except KeyboardInterrupt:
                print("\n🛑 모니터링 중지")
    else:
        monitor.generate_report()